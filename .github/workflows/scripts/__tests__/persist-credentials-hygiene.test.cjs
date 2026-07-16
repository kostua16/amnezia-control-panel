/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every actions/checkout step in a read-only workflow
// (contents: read, no contents: write anywhere in the file) must set
// persist-credentials: false. Catches credential hygiene drift — without this
// guard, GITHUB_TOKEN persists in the runner's git config after checkout,
// creating unnecessary attack surface on self-hosted runners.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

/**
 * Parse a workflow YAML into per-job step arrays.
 * Uses regex scanning (no YAML dependency) consistent with other e2e tests.
 *
 * Returns { jobName: { name, steps: [{ uses?, name?, withKeys? }] } }
 */
function parseWorkflowJobs(content) {
  const jobs = {};
  const lines = content.split('\n');

  // Collect all top-level job keys: lines matching "  <name>:" where
  // the next non-empty line is indented >=4 spaces (i.e. a mapping block).
  const jobRanges = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^  (\S+):\s*$/);
    if (!m) continue;
    const name = m[1];
    if (
      [
        'on',
        'permissions',
        'concurrency',
        'env',
        'name',
        'run-name',
        'jobs',
      ].includes(name)
    )
      continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && lines[j].match(/^    /)) {
      jobRanges.push({ name, startLine: i });
    }
  }

  for (let idx = 0; idx < jobRanges.length; idx++) {
    const { name, startLine } = jobRanges[idx];
    const endLine =
      idx + 1 < jobRanges.length ? jobRanges[idx + 1].startLine : lines.length;

    const steps = [];
    const stepStartIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (i >= startLine && i < endLine && /^      - /.test(lines[i])) {
        stepStartIndices.push(i);
      }
    }
    for (let si = 0; si < stepStartIndices.length; si++) {
      const sStart = stepStartIndices[si];
      const sEnd =
        si + 1 < stepStartIndices.length ? stepStartIndices[si + 1] : endLine;
      const stepBlock = lines.slice(sStart, sEnd).join('\n');

      const usesMatch = stepBlock.match(/uses:\s*(\S+)/);
      const withKeys = [];
      let inWith = false;
      for (let k = sStart + 1; k < sEnd; k++) {
        if (/^        with:\s*$/.test(lines[k])) {
          inWith = true;
          continue;
        }
        if (!inWith) continue;
        if (lines[k].trim() === '') continue;
        const keyMatch = lines[k].match(/^          (\S+):\s/);
        if (keyMatch) {
          withKeys.push(keyMatch[1]);
        } else {
          break;
        }
      }

      steps.push({
        uses: usesMatch ? usesMatch[1] : null,
        name: stepBlock.match(/name:\s*(.+)/)?.[1]?.trim() || null,
        withKeys,
      });
    }
    jobs[name] = { name, steps };
  }
  return jobs;
}

/**
 * Check whether a workflow file is read-only: has `contents: read` but
 * no `contents: write` anywhere in the file.
 */
function isReadOnlyWorkflow(content) {
  const hasRead = /contents:\s*read/.test(content);
  const hasWrite = /contents:\s*write/.test(content);
  return hasRead && !hasWrite;
}

/**
 * Check whether a step is an actions/checkout action.
 */
function isCheckoutStep(step) {
  return step.uses && step.uses.startsWith('actions/checkout@');
}

test('every checkout step in read-only workflows has persist-credentials: false', () => {
  const ymlFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') && !f.startsWith('_'));

  const violations = [];

  for (const file of ymlFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    if (!isReadOnlyWorkflow(content)) continue;

    const jobs = parseWorkflowJobs(content);

    for (const [, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (
          isCheckoutStep(step) &&
          !step.withKeys.includes('persist-credentials')
        ) {
          const stepLabel = step.name || step.uses;
          violations.push({
            file,
            job: job.name,
            step: stepLabel,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    const msg = violations
      .map((v) => `  ${v.file} → job "${v.job}" → step "${v.step}"`)
      .join('\n');
    assert.fail(
      `${violations.length} checkout step(s) in read-only workflows lack persist-credentials: false:\n${msg}`,
    );
  }
});

// claude-code-action's progress tracking (tag mode) runs an authenticated
// `git fetch` during branch setup, before the agent executes a single turn.
// run-claude-params enables it only for issues / issue_comment /
// pull_request* events, so combining
//   - a checkout hardened with persist-credentials: false,
//   - a run-zai step with track-progress: 'true', and
//   - a trigger event where track_progress resolves true
// fails deterministically at 0 turns (this exact trap broke every
// issues-event triage run). Either drop track-progress or keep checkout
// credentials for that workflow.
test('hardened checkouts never combine with track-progress on tag-mode events', () => {
  const TRACKED_EVENT_RE =
    /^ {2}(issues|issue_comment|pull_request|pull_request_review|pull_request_review_comment):/m;

  const ymlFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml'));

  const violations = [];
  for (const file of ymlFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    // Anything but a literal 'false' can enable tag mode at runtime — the
    // original regression used the expression form
    // track-progress: "${{ github.event_name != 'workflow_dispatch' }}".
    const trackProgressValues = [
      ...content.matchAll(/track-progress:\s*(.+)/g),
    ].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
    const mayEnableTracking =
      trackProgressValues.length > 0 &&
      trackProgressValues.some((v) => v !== 'false');
    if (!mayEnableTracking) continue;
    if (!/persist-credentials:\s*false/.test(content)) continue;

    // Extract the top-level `on:` block (up to the next top-level key).
    const onMatch = content.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m);
    const onBlock = onMatch ? onMatch[1] : '';
    if (TRACKED_EVENT_RE.test(onBlock)) {
      violations.push(file);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `workflow(s) combine persist-credentials: false with track-progress: 'true' on an event where tag mode activates — branch setup will fail at 0 turns: ${violations.join(', ')}`,
  );
});
