/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyPathKind,
  dominantKindForPr,
  selectStalePrs,
  groupStalePrs,
  conflictRiskFor,
  recommendActionForGroup,
} = require('../merge-pr-logic.cjs');

const NOW = new Date('2026-06-24T00:00:00Z');
const OLD = '2026-06-20T00:00:00Z'; // ~96h old
const FRESH = '2026-06-23T22:00:00Z'; // ~2h old

function pr(over = {}) {
  return {
    number: 1,
    title: 't',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'feature',
    createdAt: OLD,
    updatedAt: OLD,
    mergeable: 'MERGEABLE',
    labels: [],
    files: [{ path: 'src/lib/x.ts' }],
    ...over,
  };
}

test('classifyPathKind maps workflow, dependency, database, planning, app-code', () => {
  assert.equal(classifyPathKind('.github/workflows/x.yml'), 'workflow');
  assert.equal(classifyPathKind('package-lock.json'), 'dependency');
  assert.equal(
    classifyPathKind('prisma/migrations/1/migration.sql'),
    'database',
  );
  assert.equal(classifyPathKind('.planning/ideas/x.md'), 'planning');
  assert.equal(classifyPathKind('src/lib/x.ts'), 'app-code');
});

test('dominantKindForPr prefers workflow when a PR spans kinds', () => {
  const kind = dominantKindForPr(
    pr({ files: [{ path: '.github/workflows/x.yml' }, { path: 'src/a.ts' }] }),
  );
  assert.equal(kind, 'workflow');
});

test('selectStalePrs keeps only age-eligible, open, same-repo, unlabeled PRs with a branch and files', () => {
  const selected = selectStalePrs(
    [
      pr({ number: 1 }),
      pr({ number: 2, createdAt: FRESH }),
      pr({ number: 3, isDraft: true }),
      pr({ number: 4, isCrossRepository: true }),
      pr({ number: 5, state: 'CLOSED' }),
      pr({ number: 6, labels: [{ name: 'do-not-merge' }] }),
      pr({ number: 7, labels: [{ name: 'keep-open' }] }),
      pr({ number: 8, labels: [{ name: 'fresh/superseded' }] }),
      pr({ number: 9, headRefName: '' }),
      pr({ number: 10, files: [] }),
    ],
    { now: NOW },
  );
  assert.deepEqual(
    selected.map((p) => p.number),
    [1],
  );
});

test('selectStalePrs honors a custom excludeLabels set', () => {
  const selected = selectStalePrs(
    [pr({ number: 1, labels: [{ name: 'custom-hold' }] })],
    { now: NOW, excludeLabels: ['custom-hold'] },
  );
  assert.equal(selected.length, 0);
});

test('groupStalePrs never mixes workflow with app-code', () => {
  const groups = groupStalePrs([
    pr({ number: 10, files: [{ path: '.github/workflows/a.yml' }] }),
    pr({ number: 11, files: [{ path: 'src/lib/a.ts' }] }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.kind).sort(), ['app-code', 'workflow']);
});

test('groupStalePrs never mixes dependency with app-code', () => {
  const groups = groupStalePrs([
    pr({ number: 20, files: [{ path: 'package-lock.json' }] }),
    pr({ number: 21, files: [{ path: 'src/lib/a.ts' }] }),
  ]);
  assert.deepEqual(groups.map((g) => g.kind).sort(), [
    'app-code',
    'dependency',
  ]);
});

test('groupStalePrs groups compatible app-code PRs together', () => {
  const groups = groupStalePrs([
    pr({ number: 30, files: [{ path: 'src/lib/a.ts' }] }),
    pr({ number: 31, files: [{ path: 'src/lib/b.ts' }] }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'app-code');
  assert.deepEqual(groups[0].source_prs, [30, 31]);
});

test('groupStalePrs enforces max group size', () => {
  const groups = groupStalePrs(
    [1, 2, 3, 4, 5].map((n) => pr({ number: n })),
    { maxGroupSize: 2 },
  );
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].source_prs, [1, 2]);
  assert.deepEqual(groups[1].source_prs, [3, 4]);
  assert.deepEqual(groups[2].source_prs, [5]);
});

test('groupStalePrs splits conflicting from clean within a kind', () => {
  const groups = groupStalePrs([
    pr({ number: 40, mergeable: 'MERGEABLE' }),
    pr({ number: 41, mergeable: 'CONFLICTING' }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].source_prs, [40]);
  assert.equal(groups[0].conflict_risk, 'low');
  assert.deepEqual(groups[1].source_prs, [41]);
  assert.equal(groups[1].conflict_risk, 'high');
  assert.equal(groups[1].recommended_action, 'rebase-first');
});

test('dependency group recommends manual-review', () => {
  const groups = groupStalePrs([
    pr({ number: 50, files: [{ path: 'package-lock.json' }] }),
  ]);
  assert.equal(groups[0].kind, 'dependency');
  assert.equal(groups[0].recommended_action, 'manual-review');
});

test('conflictRiskFor maps mergeable states to risk levels', () => {
  assert.equal(conflictRiskFor(['MERGEABLE', 'MERGEABLE']), 'low');
  assert.equal(conflictRiskFor(['MERGEABLE', 'UNKNOWN']), 'medium');
  assert.equal(conflictRiskFor(['MERGEABLE', 'CONFLICTING']), 'high');
});

test('recommendActionForGroup returns report-only for empty groups', () => {
  assert.equal(
    recommendActionForGroup({ source_prs: [], conflict_risk: 'low' }),
    'report-only',
  );
});
