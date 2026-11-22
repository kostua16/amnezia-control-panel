/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { selectStalePrs, groupStalePrs } = require('../merge-pr-logic.cjs');
const {
  DECISION_CODES,
  finalizeStalePrSelection,
  getArg,
  isDryRun,
} = require('../run-merge-pr-selection.cjs');
const { renderMergePrReport } = require('../upsert-merge-pr-report.cjs');

// Live report on #859 from run 31363883503: only skipped group was
// workflow-877 / rebase-first, dry-run, no selected groups, no closure.
const RUN_31363883503_NOW = new Date('2026-08-10T06:57:27.115Z');

function pr(over = {}) {
  return {
    number: 1,
    title: 't',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'feature',
    createdAt: '2026-06-20T00:00:00Z',
    updatedAt: '2026-06-20T00:00:00Z',
    mergeable: 'MERGEABLE',
    labels: [],
    files: [{ path: 'src/lib/x.ts' }],
    headRefOid: 'sha',
    ...over,
  };
}

function selectAndFinalize(prs, extra = {}) {
  const stale = selectStalePrs(prs, {
    now: extra.now ?? new Date('2026-06-24T00:00:00Z'),
  });
  const groups = groupStalePrs(stale, extra.groupOptions ?? {});
  return finalizeStalePrSelection({
    groups,
    stalePrCount: stale.length,
    minAgeHours: extra.minAgeHours ?? 23,
    maxGroups: extra.maxGroups ?? 1,
    groupFilter: extra.groupFilter ?? '',
    dryRun: extra.dryRun ?? true,
  });
}

test('run 31363883503: workflow-877 is rebase-first with explicit reason and no closure', () => {
  const result = selectAndFinalize(
    [
      pr({
        number: 877,
        title: 'workflow-877',
        createdAt: '2026-08-08T00:00:00Z',
        mergeable: 'CONFLICTING',
        files: [{ path: '.github/workflows/stale.yml' }],
        headRefName: 'claude/workflow-877',
      }),
    ],
    { now: RUN_31363883503_NOW, dryRun: true },
  );

  assert.equal(result.selected.length, 0);
  assert.equal(result.unsafe.length, 1);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.capped_deferred.length, 0);

  const group = result.unsafe[0];
  assert.equal(group.group_id, 'workflow-877');
  assert.deepEqual(group.source_prs, [877]);
  assert.equal(group.kind, 'workflow');
  assert.equal(group.conflict_risk, 'high');
  assert.equal(group.action, 'rebase-first');
  assert.equal(group.recommended_action, 'rebase-first');
  assert.equal(group.decision_code, DECISION_CODES.REBASE_FIRST_CONFLICT);
  assert.match(group.reason, /rebased in place/i);
  assert.notEqual(group.reason, 'rebase-first');
  assert.equal(group.consolidation_eligible, false);
  assert.equal(group.closure_policy, 'not-eligible');
  assert.equal(group.closure_status, 'not-attempted');
  assert.equal(group.disposition, 'unsafe');

  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].conflict_risk, 'high');
  assert.equal(result.skipped[0].decision_code, group.decision_code);

  assert.deepEqual(result.closure_results, [
    {
      pr: 877,
      closed: false,
      status: 'not-attempted',
      reason: 'dry-run; write path deferred',
    },
  ]);
  assert.equal(result.validation.dryRun, true);
  assert.equal(result.validation.minAgeHours, 23);
  assert.equal(result.validation.maxGroups, 1);
  assert.equal(result.validation.groupFilter, '');
  assert.equal(result.validation.stalePrCount, 1);
  assert.equal(result.validation.groupCount, 1);
  assert.equal(result.validation.unsafeCount, 1);

  const md = renderMergePrReport({
    runUrl:
      'https://github.com/kostua16/amnezia-control-panel/actions/runs/31363883503',
    selectedGroups: result.selected,
    skippedGroups: result.skipped,
    allGroups: result.all,
    closureResults: result.closure_results,
    validation: result.validation,
  });
  assert.match(md, /workflow-877/);
  assert.match(md, /#877/);
  assert.match(md, /REBASE_FIRST_CONFLICT/);
  assert.match(md, /rebased in place/i);
  assert.match(md, /not attempted/);
  assert.doesNotMatch(md, /#877: closed/);
  assert.doesNotMatch(md, /\| closed \|/);
});

test('consolidate group is selected with eligibility and deferred closure', () => {
  const result = selectAndFinalize([
    pr({ number: 30, files: [{ path: 'src/lib/a.ts' }] }),
    pr({ number: 31, files: [{ path: 'src/lib/b.ts' }] }),
  ]);
  assert.equal(result.selected.length, 1);
  const group = result.selected[0];
  assert.equal(group.group_id, 'app-code-30-31');
  assert.equal(group.action, 'consolidate');
  assert.equal(group.decision_code, DECISION_CODES.CONSOLIDATE_SELECTED);
  assert.equal(group.consolidation_eligible, true);
  assert.equal(group.closure_policy, 'deferred-write-path');
  assert.equal(group.closure_status, 'not-attempted');
  assert.equal(group.rejection_reason, null);
});

test('dependency group is unsafe manual-review, not selected', () => {
  const result = selectAndFinalize([
    pr({ number: 50, files: [{ path: 'package-lock.json' }] }),
  ]);
  assert.equal(result.selected.length, 0);
  assert.equal(result.unsafe[0].kind, 'dependency');
  assert.equal(result.unsafe[0].action, 'manual-review');
  assert.equal(
    result.unsafe[0].decision_code,
    DECISION_CODES.MANUAL_REVIEW_DEPENDENCY,
  );
  assert.match(result.unsafe[0].reason, /[Dd]ependency/);
  assert.equal(result.unsafe[0].consolidation_eligible, false);
});

test('multi-PR conflict group is unsafe manual-review', () => {
  const result = selectAndFinalize([
    pr({ number: 60, mergeable: 'CONFLICTING' }),
    pr({ number: 61, mergeable: 'CONFLICTING' }),
  ]);
  assert.equal(result.unsafe.length, 1);
  assert.equal(
    result.unsafe[0].decision_code,
    DECISION_CODES.MANUAL_REVIEW_MULTI_CONFLICT,
  );
  assert.match(result.unsafe[0].reason, /[Mm]utually conflicting/);
});

test('dry-run and write mode both leave closure not-attempted today', () => {
  const prs = [pr({ number: 40 })];
  const dry = selectAndFinalize(prs, { dryRun: true });
  const write = selectAndFinalize(prs, { dryRun: false });
  assert.equal(dry.validation.dryRun, true);
  assert.equal(write.validation.dryRun, false);
  assert.equal(dry.closure_results[0].status, 'not-attempted');
  assert.equal(write.closure_results[0].status, 'not-attempted');
  assert.equal(dry.closure_results[0].closed, false);
  assert.equal(write.closure_results[0].closed, false);
  assert.match(dry.closure_results[0].reason, /dry-run/);
  assert.match(write.closure_results[0].reason, /write path deferred/);
});

test('all[] preserves kind-then-number ordering', () => {
  const result = selectAndFinalize([
    pr({ number: 11, files: [{ path: 'src/lib/a.ts' }] }),
    pr({ number: 10, files: [{ path: '.github/workflows/a.yml' }] }),
    pr({ number: 12, files: [{ path: 'package-lock.json' }] }),
  ]);
  assert.deepEqual(
    result.all.map((g) => g.group_id),
    ['workflow-10', 'dependency-12', 'app-code-11'],
  );
});

test('empty input yields empty buckets and zero counts', () => {
  const result = selectAndFinalize([]);
  assert.deepEqual(result.all, []);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.closure_results, []);
  assert.equal(result.validation.stalePrCount, 0);
  assert.equal(result.validation.groupCount, 0);
  assert.equal(result.validation.selectedCount, 0);
});

test('group filter keeps the matching group and marks others filtered', () => {
  const result = selectAndFinalize(
    [
      pr({ number: 10, files: [{ path: '.github/workflows/a.yml' }] }),
      pr({ number: 11, files: [{ path: 'src/lib/a.ts' }] }),
    ],
    { groupFilter: 'app-code-11', maxGroups: 1 },
  );
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].group_id, 'app-code-11');
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].group_id, 'workflow-10');
  assert.equal(result.filtered[0].decision_code, DECISION_CODES.FILTERED_OUT);
  assert.equal(result.filtered[0].disposition, 'filtered');
  assert.equal(result.validation.groupFilter, 'app-code-11');
  assert.equal(result.validation.filteredCount, 1);
  assert.ok(result.skipped.some((g) => g.group_id === 'workflow-10'));
});

test('filtered unsafe group keeps its underlying rejection reason', () => {
  const result = selectAndFinalize(
    [
      pr({
        number: 10,
        files: [{ path: '.github/workflows/a.yml' }],
        mergeable: 'CONFLICTING',
      }),
      pr({ number: 11, files: [{ path: 'src/lib/a.ts' }] }),
    ],
    { groupFilter: 'app-code-11', maxGroups: 1 },
  );
  const filtered = result.filtered[0];
  assert.equal(filtered.group_id, 'workflow-10');
  assert.equal(filtered.decision_code, DECISION_CODES.FILTERED_OUT);
  assert.match(filtered.reason, /group_filter match/);
  assert.match(filtered.reason, /rebased in place/);
  assert.match(filtered.rejection_reason, /rebased in place/);
});

test('max_groups cap defers extra consolidate groups', () => {
  const result = selectAndFinalize(
    [1, 2, 3, 4].map((n) => pr({ number: n })),
    { maxGroups: 1, groupOptions: { maxGroupSize: 2 } },
  );
  assert.equal(result.selected.length, 1);
  assert.deepEqual(result.selected[0].source_prs, [1, 2]);
  assert.equal(result.capped_deferred.length, 1);
  assert.deepEqual(result.capped_deferred[0].source_prs, [3, 4]);
  assert.equal(
    result.capped_deferred[0].decision_code,
    DECISION_CODES.CONSOLIDATE_CAPPED,
  );
  assert.equal(result.capped_deferred[0].disposition, 'capped-deferred');
  assert.equal(result.capped_deferred[0].consolidation_eligible, true);
  assert.equal(result.validation.maxGroups, 1);
  assert.equal(result.validation.cappedDeferredCount, 1);
});

test('--dry-run parsing fails closed to dry-run', () => {
  const argv = (...args) => ['node', 'run-merge-pr-selection.cjs', ...args];
  // A bare --dry-run followed by another flag must not adopt it as the value.
  assert.equal(
    getArg('--dry-run', 'true', argv('--dry-run', '--out-dir', '.')),
    'true',
  );
  assert.equal(getArg('--dry-run', 'true', argv('--max-groups', '1')), 'true');
  assert.equal(getArg('--dry-run', 'true', argv('--dry-run')), 'true');
  assert.equal(
    getArg('--dry-run', 'true', argv('--dry-run', 'false')),
    'false',
  );
  // Only an explicit `false` enables the write path, as in the report step.
  for (const value of [true, 'true', 'TRUE', '1', '', '--out-dir', undefined]) {
    assert.equal(isDryRun(value), true, `isDryRun(${String(value)})`);
  }
  assert.equal(isDryRun(false), false);
  assert.equal(isDryRun('false'), false);
});

test('CLI stays in dry-run unless --dry-run is an explicit false', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-pr-selection-'));
  try {
    const validationDryRun = (...args) => {
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, '..', 'run-merge-pr-selection.cjs'),
          '--in',
          '-',
          '--out-dir',
          outDir,
          ...args,
        ],
        { encoding: 'utf8', input: '[]' },
      );
      const { validation } = JSON.parse(
        fs.readFileSync(path.join(outDir, 'merge-pr-groups.json'), 'utf8'),
      );
      return validation.dryRun;
    };

    assert.equal(validationDryRun(), true);
    // The flag must not adopt the flag after it as its value.
    assert.equal(validationDryRun('--dry-run', '--out-dir', outDir), true);
    assert.equal(validationDryRun('--dry-run', 'TRUE'), true);
    assert.equal(validationDryRun('--dry-run', 'false'), false);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('unrecognized recommended_action is unsafe, never consolidation-eligible', () => {
  const groupWith = (recommended_action) => ({
    id: 'app-code-70',
    kind: 'app-code',
    conflict_risk: 'low',
    source_prs: [70],
    recommended_action,
    rejection_reason: null,
  });

  for (const action of ['needs-human', undefined]) {
    const result = finalizeStalePrSelection({
      groups: [groupWith(action)],
      stalePrCount: 1,
    });
    assert.equal(result.selected.length, 0);
    const group = result.unsafe[0];
    assert.equal(group.disposition, 'unsafe');
    assert.equal(group.consolidation_eligible, false);
    assert.equal(group.closure_policy, 'not-eligible');
    assert.equal(
      group.decision_code,
      DECISION_CODES.MANUAL_REVIEW_UNKNOWN_ACTION,
    );
    assert.match(group.reason, /not auto-consolidated/);
  }

  // A populated rejection_reason must not mask the unrecognized-action cause:
  // the grouping layer's fall-through reason labels non-empty groups "empty".
  const populated = finalizeStalePrSelection({
    groups: [
      {
        ...groupWith('needs-human'),
        rejection_reason: 'Empty group cannot be consolidated',
      },
    ],
    stalePrCount: 1,
  }).unsafe[0];
  assert.equal(
    populated.decision_code,
    DECISION_CODES.MANUAL_REVIEW_UNKNOWN_ACTION,
  );
  assert.match(populated.reason, /^Unrecognized recommended_action/);
  assert.match(
    populated.reason,
    /underlying: Empty group cannot be consolidated$/,
  );

  // A filtered unknown action keeps the unrecognized-action cause.
  const filtered = finalizeStalePrSelection({
    groups: [groupWith('needs-human')],
    groupFilter: 'other-group',
  }).filtered[0];
  assert.equal(filtered.decision_code, DECISION_CODES.FILTERED_OUT);
  assert.match(filtered.reason, /group_filter match; underlying: Unrecognized/);
});
