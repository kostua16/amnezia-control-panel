// Read-once / write-only-differences reconciliation of policy labels.
//
// The existing labels are read with one `gh label list` call (served by the
// GraphQL API, so it does not spend the REST quota that every workflow job of
// the installation token shares). Only missing labels are created and only
// labels whose color or description drifted are updated, so a repository that
// already matches policy.json costs zero REST writes.

const MAX_WRITE_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;
// gh paginates `label list` itself; the limit only bounds the total.
const LIST_LIMIT = '1000';

function errorText(error) {
  return [error?.stderr, error?.stdout, error?.message, error]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n');
}

function firstLine(error) {
  return (errorText(error) || String(error)).trim().split('\n')[0];
}

// An exhausted quota is not transient within a job: retrying only sleeps, and
// every further call fails the same way. A bare 403 is not treated as quota:
// permission and SSO failures also answer 403 and must keep their own path.
function isQuotaError(error) {
  return /rate limit|HTTP 429\b|\(HTTP 429\)/i.test(errorText(error));
}

// A 403 that is not a rate limit (missing permission, SSO enforcement) cannot
// succeed on any retry or per-label fallback either; it is reported as such
// instead of as quota.
function isForbiddenError(error) {
  return (
    !isQuotaError(error) && /HTTP 403\b|\(HTTP 403\)/i.test(errorText(error))
  );
}

// A concurrent reconciler (another PR's run) created the label between our
// read and our create: the label now exists, which is what we wanted.
function isAlreadyExistsError(error) {
  return /already[ _]exists/i.test(errorText(error));
}

function isNotFoundError(error) {
  return /HTTP 404\b|\(HTTP 404\)|Not Found/i.test(errorText(error));
}

function normalizeColor(color) {
  return String(color ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
}

function normalizeDescription(description) {
  return String(description ?? '').trim();
}

function listExistingLabels(run) {
  const stdout = run([
    'label',
    'list',
    '--json',
    'name,color,description',
    '--limit',
    LIST_LIMIT,
  ]);
  const parsed = JSON.parse(String(stdout ?? ''));
  if (!Array.isArray(parsed)) {
    throw new Error('gh label list did not return a JSON array');
  }
  return parsed;
}

// Names are matched case-insensitively (GitHub label names are), and a label
// that exists under another spelling is never renamed: updates address it by
// the repository's own spelling.
function planLabelChanges(names, labels, existing) {
  const current = new Map(
    existing.map((label) => [String(label.name).toLowerCase(), label]),
  );
  const seen = new Set();
  const plan = { create: [], update: [], unchanged: 0 };
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const wanted = labels[name];
    const found = current.get(key);
    if (!found) {
      plan.create.push({ name, label: wanted });
    } else if (
      normalizeColor(found.color) !== normalizeColor(wanted.color) ||
      normalizeDescription(found.description) !==
        normalizeDescription(wanted.description)
    ) {
      plan.update.push({ name: String(found.name), label: wanted });
    } else {
      plan.unchanged += 1;
    }
  }
  return plan;
}

function createArgs({ name, label }) {
  return [
    'label',
    'create',
    name,
    '--color',
    normalizeColor(label.color),
    '--description',
    normalizeDescription(label.description),
  ];
}

// Label names contain `/` (e.g. `area/planning`), so the path segment is
// encoded explicitly. `-f` sends raw strings (no `@file` expansion).
function updateArgs({ name, label }) {
  return [
    'api',
    '--method',
    'PATCH',
    `repos/{owner}/{repo}/labels/${encodeURIComponent(name)}`,
    '-f',
    `color=${normalizeColor(label.color)}`,
    '-f',
    `description=${normalizeDescription(label.description)}`,
    '--silent',
  ];
}

// Returns 'ok' | 'exists' | 'missing' | 'quota' | 'forbidden' | 'failed'. Only unknown
// errors are retried; their final failure is a warning, never a job failure.
function runWrite(args, { run, wait }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      run(args);
      return { outcome: 'ok' };
    } catch (error) {
      if (isQuotaError(error)) return { outcome: 'quota', error };
      if (isForbiddenError(error)) return { outcome: 'forbidden', error };
      if (isAlreadyExistsError(error)) return { outcome: 'exists', error };
      if (isNotFoundError(error)) return { outcome: 'missing', error };
      lastError = error;
      if (attempt < MAX_WRITE_ATTEMPTS) {
        wait(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  return { outcome: 'failed', error: lastError };
}

function applyLabelPlan(plan, { run, wait, warn = console.warn }) {
  const result = { created: 0, updated: 0, failed: 0, skipped: 0 };
  const writes = [
    ...plan.create.map((item) => ({ kind: 'create', item })),
    ...plan.update.map((item) => ({ kind: 'update', item })),
  ];
  for (let index = 0; index < writes.length; index += 1) {
    const { kind, item } = writes[index];
    const args = kind === 'create' ? createArgs(item) : updateArgs(item);
    const { outcome, error } = runWrite(args, { run, wait });
    if (outcome === 'ok' || (kind === 'create' && outcome === 'exists')) {
      if (kind === 'create') result.created += 1;
      else result.updated += 1;
      continue;
    }
    result.failed += 1;
    if (outcome === 'quota') {
      result.skipped = writes.length - index - 1;
      warn(
        `::warning::GitHub API quota exhausted while ensuring label "${item.name}" (${firstLine(error)}); skipping ${result.skipped} remaining label write(s) — labels are idempotent setup, not validation.`,
      );
      break;
    }
    if (outcome === 'forbidden') {
      // A permission failure repeats for every remaining write: stop instead of
      // retrying each one.
      result.skipped = writes.length - index - 1;
      warn(
        `::warning::The token lacks permission to write label "${item.name}" (${firstLine(error)}); skipping ${result.skipped} remaining label write(s) — labels are idempotent setup, not validation.`,
      );
      break;
    }
    const reason =
      outcome === 'missing'
        ? 'label disappeared before the update'
        : firstLine(error);
    warn(
      `::warning::Could not ${kind} label "${item.name}" (${reason}); continuing — labels are idempotent setup, not validation.`,
    );
  }
  return result;
}

module.exports = {
  applyLabelPlan,
  createArgs,
  isAlreadyExistsError,
  isForbiddenError,
  isNotFoundError,
  isQuotaError,
  listExistingLabels,
  planLabelChanges,
  updateArgs,
};
