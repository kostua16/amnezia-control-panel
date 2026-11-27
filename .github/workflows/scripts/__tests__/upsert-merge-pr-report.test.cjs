/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMergePrReport,
  BUCKETS,
  DECISION_BUCKETS,
  REPORT_MARKER,
} = require('../upsert-merge-pr-report.cjs');
const { DECISION_CODES } = require('../run-merge-pr-selection.cjs');

test('every selection decision code maps to a header bucket', () => {
  for (const code of Object.values(DECISION_CODES)) {
    assert.ok(
      Object.hasOwn(DECISION_BUCKETS, code),
      `missing bucket for ${code}`,
    );
  }
  // A mistyped or renamed bucket value would silently degrade to Unclassified.
  for (const [code, bucket] of Object.entries(DECISION_BUCKETS)) {
    assert.ok(BUCKETS.has(bucket), `${code} maps to unknown bucket ${bucket}`);
  }
});

test('always emits the sticky marker and core headers', () => {
  const md = renderMergePrReport({});
  assert.ok(md.startsWith(REPORT_MARKER));
  assert.match(md, /# Stale PR consolidation report/);
  assert.match(md, /## Groups/);
  assert.match(md, /## Replacement PRs/);
  assert.match(md, /## Source PR closure results/);
  assert.match(md, /## Validation/);
});

test('labels every section empty when there is no activity', () => {
  const md = renderMergePrReport({});
  assert.match(
    md,
    /## Groups\n_Selected: 0 · Unsafe: 0 · Filtered: 0 · Capped: 0_\n\n_None\./,
  );
  assert.match(md, /## Replacement PRs\n_None\./);
  assert.match(md, /## Source PR closure results\n_None\./);
});

test('renders a stable table of all groups with PR/kind/risk/action/reason/closure', () => {
  const md = renderMergePrReport({
    runUrl: 'https://example/run/1',
    selectedGroups: [
      {
        id: 'app-code-460-444',
        group_id: 'app-code-460-444',
        kind: 'app-code',
        conflict_risk: 'low',
        action: 'consolidate',
        recommended_action: 'consolidate',
        decision_code: 'CONSOLIDATE_SELECTED',
        reason: 'Kind-strict compatible group is eligible for consolidation',
        consolidation_eligible: true,
        disposition: 'selected',
        source_prs: [460, 444],
      },
    ],
    skippedGroups: [
      {
        id: 'dependency-50',
        group_id: 'dependency-50',
        kind: 'dependency',
        conflict_risk: 'low',
        action: 'manual-review',
        decision_code: 'MANUAL_REVIEW_DEPENDENCY',
        reason:
          'Dependency groups require manual review and are not auto-consolidated',
        consolidation_eligible: false,
        disposition: 'unsafe',
        source_prs: [50],
      },
    ],
    allGroups: [
      {
        id: 'app-code-460-444',
        group_id: 'app-code-460-444',
        kind: 'app-code',
        conflict_risk: 'low',
        action: 'consolidate',
        decision_code: 'CONSOLIDATE_SELECTED',
        reason: 'Kind-strict compatible group is eligible for consolidation',
        consolidation_eligible: true,
        disposition: 'selected',
        source_prs: [460, 444],
      },
      {
        id: 'dependency-50',
        group_id: 'dependency-50',
        kind: 'dependency',
        conflict_risk: 'low',
        action: 'manual-review',
        decision_code: 'MANUAL_REVIEW_DEPENDENCY',
        reason:
          'Dependency groups require manual review and are not auto-consolidated',
        consolidation_eligible: false,
        disposition: 'unsafe',
        source_prs: [50],
      },
    ],
    replacementPrUrls: ['https://example/pull/500'],
    closureResults: [
      { pr: 460, closed: true, status: 'closed' },
      { pr: 444, closed: false, reason: 'source updated after collection' },
      { pr: 50, closed: false, status: 'not-attempted' },
    ],
    validation: { test: 'pass', build: 'pass', dryRun: false },
  });
  assert.match(
    md,
    /\| Group \| PRs \| Kind \| Risk \| Action \| Decision \| Reason \| Eligible \| Closure \|/,
  );
  assert.match(md, /app-code-460-444/);
  assert.match(md, /#460, #444/);
  assert.match(md, /#460: closed, #444: left open/);
  assert.match(md, /CONSOLIDATE_SELECTED/);
  assert.match(md, /dependency-50/);
  assert.match(md, /MANUAL_REVIEW_DEPENDENCY/);
  assert.match(md, /- https:\/\/example\/pull\/500/);
  assert.match(md, /#460: closed/);
  assert.match(md, /#444: left open — source updated after collection/);
  assert.match(md, /Mode: write/);
  assert.match(md, /"test": "pass"/);
});

test('dry-run validation reports dry-run mode and never prints closed', () => {
  const md = renderMergePrReport({
    validation: { dryRun: true, minAgeHours: 23, maxGroups: 1 },
    allGroups: [
      {
        group_id: 'workflow-877',
        kind: 'workflow',
        conflict_risk: 'high',
        action: 'rebase-first',
        decision_code: 'REBASE_FIRST_CONFLICT',
        reason:
          'Single conflicting PR should be rebased in place before consolidation',
        source_prs: [877],
        disposition: 'unsafe',
      },
    ],
    closureResults: [{ pr: 877, closed: true, reason: 'should be ignored' }],
  });
  assert.match(md, /Mode: dry-run/);
  assert.match(md, /not attempted/);
  assert.doesNotMatch(md, /#877: closed/);
  assert.doesNotMatch(md, /\| closed \|/);
  assert.match(md, /"minAgeHours": 23/);
  assert.match(md, /"maxGroups": 1/);
});

test('header counts the rendered groups, not only the selected list', () => {
  const selected = {
    group_id: 'app-code-1',
    source_prs: [1],
    disposition: 'selected',
  };
  const unsafe = {
    group_id: 'workflow-2',
    source_prs: [2],
    disposition: 'unsafe',
  };
  const header = (md) => /_Selected: [^\n]*_/.exec(md)[0];

  // allGroups alone: the header must still count the selected row it renders.
  assert.equal(
    header(renderMergePrReport({ allGroups: [selected, unsafe] })),
    '_Selected: 1 · Unsafe: 1 · Filtered: 0 · Capped: 0_',
  );
  // Drift between the lists must not desynchronize the header and the table.
  assert.equal(
    header(
      renderMergePrReport({
        selectedGroups: [selected, selected],
        allGroups: [selected, unsafe],
      }),
    ),
    '_Selected: 1 · Unsafe: 1 · Filtered: 0 · Capped: 0_',
  );
  // Groups without a disposition fall back to the selected list; skipped rows
  // with no known bucket are counted as Unclassified so the header still adds
  // up to the rendered table rows.
  assert.equal(
    header(
      renderMergePrReport({
        selectedGroups: [{ id: 'app-code-1', source_prs: [1] }],
        skippedGroups: [{ id: 'workflow-2', source_prs: [2] }],
      }),
    ),
    '_Selected: 1 · Unsafe: 0 · Filtered: 0 · Capped: 0 · Unclassified: 1_',
  );
  // Rows rebuilt without a disposition are bucketed by their decision_code.
  assert.equal(
    header(
      renderMergePrReport({
        skippedGroups: [
          { id: 'a', source_prs: [1], decision_code: 'CONSOLIDATE_CAPPED' },
          { id: 'b', source_prs: [2], decision_code: 'FILTERED_OUT' },
          { id: 'c', source_prs: [3], decision_code: 'REBASE_FIRST_CONFLICT' },
        ],
      }),
    ),
    '_Selected: 0 · Unsafe: 1 · Filtered: 1 · Capped: 1_',
  );
  // Unrecognized dispositions and inherited keys fall through to Unclassified
  // instead of vanishing from every header count.
  assert.equal(
    header(
      renderMergePrReport({
        skippedGroups: [
          { id: 'a', source_prs: [1], disposition: 'capped' },
          { id: 'b', source_prs: [2], disposition: '' },
          { id: 'c', source_prs: [3], decision_code: 'constructor' },
        ],
      }),
    ),
    '_Selected: 0 · Unsafe: 0 · Filtered: 0 · Capped: 0 · Unclassified: 3_',
  );
  // Id-less rows must not match each other through an undefined id key.
  const idlessSelected = { source_prs: [1] };
  assert.equal(
    header(
      renderMergePrReport({
        selectedGroups: [idlessSelected],
        skippedGroups: [{ source_prs: [2] }],
      }),
    ),
    '_Selected: 1 · Unsafe: 0 · Filtered: 0 · Capped: 0 · Unclassified: 1_',
  );
  // A partially dispositioned payload counts per row: the undispositioned
  // selected row must not vanish from the Selected count.
  const undispositioned = { group_id: 'app-code-9', source_prs: [9] };
  assert.equal(
    header(
      renderMergePrReport({
        selectedGroups: [selected, undispositioned],
        allGroups: [selected, unsafe, undispositioned],
      }),
    ),
    '_Selected: 2 · Unsafe: 1 · Filtered: 0 · Capped: 0_',
  );
});
