/* eslint-disable @typescript-eslint/no-require-imports */
// Renders and upserts the stale-PR consolidation report. One central tracking
// issue (found by title + sticky marker, created if absent) carries every run's
// selected groups, skipped groups, replacement PRs, source closure results, and
// validation summary, so consolidation state is reviewable in one place instead
// of scattered across source PR comments. Also optionally appends to the job
// summary. renderMergePrReport is pure and unit-tested; main() is thin IO glue.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CLOSURE_REASONS } = require('./merge-pr-logic.cjs');

const REPORT_MARKER = '<!-- merge-pr-report -->';
const DEFAULT_ISSUE_TITLE = 'Stale PR consolidation report';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function isDryRun(validation) {
  return validation?.dryRun !== false && validation?.dryRun !== 'false';
}

function collectGroups({ selectedGroups, skippedGroups, allGroups }) {
  if (Array.isArray(allGroups) && allGroups.length > 0) return allGroups;
  return [...(selectedGroups || []), ...(skippedGroups || [])];
}

// Rows rebuilt without a disposition (older stubs, skipped_json replays) still
// carry a decision_code that names their bucket unambiguously.
const DECISION_BUCKETS = {
  CONSOLIDATE_SELECTED: 'selected',
  CONSOLIDATE_CAPPED: 'capped-deferred',
  FILTERED_OUT: 'filtered',
  REBASE_FIRST_CONFLICT: 'unsafe',
  MANUAL_REVIEW_MULTI_CONFLICT: 'unsafe',
  MANUAL_REVIEW_DEPENDENCY: 'unsafe',
  MANUAL_REVIEW_UNKNOWN_ACTION: 'unsafe',
  REPORT_ONLY_EMPTY: 'unsafe',
};

const BUCKETS = new Set(['selected', 'unsafe', 'filtered', 'capped-deferred']);

// Only a recognized bucket counts: an unknown disposition string or an
// inherited key (`constructor`, `__proto__`) falls through to null so the row
// lands in Unclassified instead of vanishing from every header count.
function bucketOf(g) {
  if (BUCKETS.has(g.disposition)) return g.disposition;
  const bucket = Object.hasOwn(DECISION_BUCKETS, g.decision_code)
    ? DECISION_BUCKETS[g.decision_code]
    : null;
  return BUCKETS.has(bucket) ? bucket : null;
}

function formatPrs(prs) {
  return (Array.isArray(prs) ? prs : []).map((n) => `#${n}`).join(', ');
}

// Dry-run (and the deferred write path) must never report a source PR as
// closed. Operators reading #859 treated an empty closure section as "maybe
// closed"; the table + this label make the no-op explicit.
function closureLabel(result, dryRun) {
  if (dryRun) return 'not attempted';
  if (!result) return 'not attempted';
  if (result.closed === true) return 'closed';
  if (result.closed === false && result.status !== 'not-attempted') {
    return 'left open';
  }
  return 'not attempted';
}

function renderGroupTable(groups, closureByPr, dryRun) {
  if (groups.length === 0) return ['_None._'];
  const lines = [
    '| Group | PRs | Kind | Risk | Action | Decision | Reason | Eligible | Closure |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const g of groups) {
    const id = g.group_id ?? g.id ?? '(group)';
    const prs = formatPrs(g.source_prs);
    // Closure is decided per source PR: once the write path lands, a group can
    // mix closed and left-open PRs, so render each PR's outcome rather than
    // letting the first PR speak for the whole row.
    const prNums = Array.isArray(g.source_prs) ? g.source_prs : [];
    const closure =
      prNums.length === 0
        ? 'not attempted'
        : prNums
            .map((n) => `#${n}: ${closureLabel(closureByPr.get(n), dryRun)}`)
            .join(', ');
    const eligible = g.consolidation_eligible === true ? 'yes' : 'no';
    const action = g.action ?? g.recommended_action ?? '';
    const reason = String(g.reason ?? g.rejection_reason ?? '').replace(
      /\|/g,
      '/',
    );
    lines.push(
      `| ${id} | ${prs} | ${g.kind ?? ''} | ${g.conflict_risk ?? ''} | ${action} | ${g.decision_code ?? ''} | ${reason} | ${eligible} | ${closure} |`,
    );
  }
  return lines;
}

function renderMergePrReport({
  runUrl,
  generatedAt,
  selectedGroups = [],
  skippedGroups = [],
  allGroups,
  replacementPrUrls = [],
  closureResults = [],
  validation = {},
}) {
  const at = generatedAt || new Date().toISOString();
  const dryRun = isDryRun(validation);
  const groups = collectGroups({
    selectedGroups,
    skippedGroups,
    allGroups,
  });
  // Header counts must describe the same rows as the table: each row's own
  // disposition (or, failing that, its decision_code) decides its bucket, and
  // only a row with neither falls back to selected-list membership — a partially dispositioned
  // payload must not under-count the selected rows it renders.
  // Id-less rows never match by id (an undefined key would collapse them
  // all together); they match only by object identity.
  const selectedRows = new Set(selectedGroups || []);
  const selectedIds = new Set(
    (selectedGroups || [])
      .map((g) => g.group_id ?? g.id)
      .filter((id) => id !== undefined && id !== null),
  );
  const isListedSelected = (g) =>
    selectedRows.has(g) || selectedIds.has(g.group_id ?? g.id);
  const countDisposition = (disposition) =>
    groups.filter((g) => bucketOf(g) === disposition).length;
  const undispositioned = groups.filter((g) => bucketOf(g) === null);
  const selectedCount =
    countDisposition('selected') +
    undispositioned.filter(isListedSelected).length;
  // Undispositioned rows outside the selected list have no known bucket; they
  // are counted explicitly so the header still adds up to the table rows.
  const unclassifiedCount = undispositioned.filter(
    (g) => !isListedSelected(g),
  ).length;
  const unsafeCount = countDisposition('unsafe');
  const filteredCount = countDisposition('filtered');
  const cappedCount = countDisposition('capped-deferred');
  const unclassifiedNote =
    unclassifiedCount > 0 ? ` · Unclassified: ${unclassifiedCount}` : '';
  const closureByPr = new Map((closureResults || []).map((c) => [c.pr, c]));
  const derivedClosure =
    closureResults.length > 0
      ? closureResults
      : groups.flatMap((g) =>
          (g.source_prs || []).map((pr) => ({
            pr,
            closed: false,
            status: 'not-attempted',
            reason: dryRun
              ? CLOSURE_REASONS.DRY_RUN
              : CLOSURE_REASONS.WRITE_DEFERRED,
          })),
        );

  const lines = [
    REPORT_MARKER,
    '# Stale PR consolidation report',
    '',
    `- Generated: ${at}`,
    `- Run: ${runUrl || '_n/a_'}`,
    `- Mode: ${dryRun ? 'dry-run' : 'write'}`,
    '',
    '## Groups',
    `_Selected: ${selectedCount} · Unsafe: ${unsafeCount} · Filtered: ${filteredCount} · Capped: ${cappedCount}${unclassifiedNote}_`,
    '',
    ...renderGroupTable(groups, closureByPr, dryRun),
    '',
    '## Replacement PRs',
  ];
  if (replacementPrUrls.length === 0) {
    lines.push('_None._');
  } else {
    for (const u of replacementPrUrls) lines.push(`- ${u}`);
  }

  lines.push('', '## Source PR closure results');
  if (derivedClosure.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of derivedClosure) {
      const status = closureLabel(c, dryRun);
      const note = c.reason ? ` — ${c.reason}` : '';
      lines.push(`- #${c.pr}: ${status}${note}`);
    }
  }

  lines.push(
    '',
    '## Validation',
    '```json',
    JSON.stringify(validation ?? {}, null, 2),
    '```',
    '',
  );
  return lines.join('\n');
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
  }).trim();
}

function findExistingIssue(repo, title) {
  const issues = JSON.parse(
    runGh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--search',
      `in:title ${JSON.stringify(title)}`,
      '--json',
      'number,title,body',
      '--limit',
      '20',
    ]) || '[]',
  );
  return (
    issues.find(
      (i) => i.title === title && String(i.body ?? '').includes(REPORT_MARKER),
    ) ?? null
  );
}

function upsertReportIssue({ repo, title, body }) {
  const bodyFile = path.join(
    os.tmpdir(),
    `merge-pr-report-${process.pid}-${Date.now()}.md`,
  );
  fs.writeFileSync(bodyFile, body, 'utf8');
  try {
    const existing = findExistingIssue(repo, title);
    if (existing) {
      runGh([
        'issue',
        'edit',
        String(existing.number),
        '--repo',
        repo,
        '--body-file',
        bodyFile,
      ]);
      return { number: existing.number, created: false };
    }
    const url = runGh([
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--label',
      'maintenance',
    ]);
    return { url, created: true };
  } finally {
    fs.rmSync(bodyFile, { force: true });
  }
}

function main() {
  const reportJson =
    getArg('--report-json') || process.env.MERGE_PR_REPORT_JSON;
  const runUrl =
    getArg('--run-url') ||
    (process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '');
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const title = getArg('--issue-title', DEFAULT_ISSUE_TITLE);
  const toSummary = getArg('--summary') === 'true';

  const data = reportJson
    ? JSON.parse(fs.readFileSync(reportJson, 'utf8'))
    : {};
  const body = renderMergePrReport({ runUrl, ...data });

  if (toSummary && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
  }
  if (repo) {
    const result = upsertReportIssue({ repo, title, body });
    console.log(
      `merge-pr report ${result.created ? 'created' : 'updated'}: ${result.url || `#${result.number}`}`,
    );
  } else {
    process.stdout.write(body);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REPORT_MARKER,
  DEFAULT_ISSUE_TITLE,
  DECISION_BUCKETS,
  renderMergePrReport,
};
