/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMergePrReport,
  REPORT_MARKER,
} = require('../upsert-merge-pr-report.cjs');

test('always emits the sticky marker and core headers', () => {
  const md = renderMergePrReport({});
  assert.ok(md.startsWith(REPORT_MARKER));
  assert.match(md, /# Stale PR consolidation report/);
  assert.match(md, /## Selected groups/);
  assert.match(md, /## Skipped groups/);
  assert.match(md, /## Replacement PRs/);
  assert.match(md, /## Source PR closure results/);
  assert.match(md, /## Validation/);
});

test('labels every section empty when there is no activity', () => {
  const md = renderMergePrReport({});
  assert.match(md, /## Selected groups\n_None\./);
  assert.match(md, /## Skipped groups\n_None\./);
  assert.match(md, /## Replacement PRs\n_None\./);
  assert.match(md, /## Source PR closure results\n_None\./);
});

test('renders selected groups, skipped reasons, replacement URLs, and closure results', () => {
  const md = renderMergePrReport({
    runUrl: 'https://example/run/1',
    selectedGroups: [
      {
        id: 'app-code-460-444',
        kind: 'app-code',
        conflict_risk: 'low',
        recommended_action: 'consolidate',
        source_prs: [460, 444],
      },
    ],
    skippedGroups: [{ id: 'dependency-50', reason: 'manual-review' }],
    replacementPrUrls: ['https://example/pull/500'],
    closureResults: [
      { pr: 460, closed: true },
      { pr: 444, closed: false, reason: 'source updated after collection' },
    ],
    validation: { test: 'pass', build: 'pass', dryRun: false },
  });
  assert.match(
    md,
    /\*\*app-code-460-444\*\* — app-code · low risk · consolidate · PRs 460, 444/,
  );
  assert.match(md, /dependency-50: manual-review/);
  assert.match(md, /- https:\/\/example\/pull\/500/);
  assert.match(md, /#460: closed/);
  assert.match(md, /#444: left open — source updated after collection/);
  assert.match(md, /Mode: write/);
  assert.match(md, /"test": "pass"/);
});

test('dry-run validation reports dry-run mode', () => {
  const md = renderMergePrReport({ validation: { dryRun: true } });
  assert.match(md, /Mode: dry-run/);
});
