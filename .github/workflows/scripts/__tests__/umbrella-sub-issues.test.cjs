/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allItemsChecked,
  applyTicks,
  buildSubIssueBody,
  buildSubIssueTitle,
  duplicateSubIssuesToClose,
  extractDocExcerpt,
  extractWorkflowName,
  isCompletedState,
  parseChecklist,
  planSpinOff,
  priorityLabel,
  subIssueMarker,
  subIssueTodoId,
} = require('../lib/umbrella-sub-issues-core.cjs');

const UMBRELLA_BODY = [
  'Umbrella tracking issue for the `audit-fix.yml` items.',
  '',
  '### Improvements',
  '',
  '- [ ] AFX-I01 (P0) Fix the chronic 30-min timeout — workflow is dead',
  '- [x] AFX-I02 (P0) File a failure issue on timeout-cancelled runs — XC-1',
  '- [ ] AFX-I03 (P1) Give the agent a wall-clock deadline — XC-2',
  '- [ ] AFX-I06 (P2) Add a pending-PR check before the agent runs',
  '- [ ] AFX-I09 (P3) Stagger 21:53 slot against the hourly :56 monitor',
  '- not a checklist line',
  '- [ ] free-form item without a stable ID',
].join('\n');

// ---------------------------------------------------------------------------
// parseChecklist
// ---------------------------------------------------------------------------
test('parseChecklist extracts ID, priority, title, and checked state', () => {
  const items = parseChecklist(UMBRELLA_BODY);
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.map((item) => item.id),
    ['AFX-I01', 'AFX-I02', 'AFX-I03', 'AFX-I06', 'AFX-I09'],
  );
  assert.equal(items[0].priority, 0);
  assert.equal(items[0].checked, false);
  assert.equal(items[1].checked, true);
  assert.ok(items[2].title.includes('wall-clock deadline'));
});

test('parseChecklist ignores non-ID checklist lines and empty bodies', () => {
  assert.equal(parseChecklist('- [ ] free-form item').length, 0);
  assert.equal(parseChecklist('').length, 0);
  assert.equal(parseChecklist(undefined).length, 0);
});

// ---------------------------------------------------------------------------
// planSpinOff — throttle + dedupe
// ---------------------------------------------------------------------------
test('planSpinOff picks unchecked items by priority up to the cap', () => {
  const plan = planSpinOff({ items: parseChecklist(UMBRELLA_BODY), cap: 3 });
  assert.deepEqual(
    plan.toCreate.map((item) => item.id),
    ['AFX-I01', 'AFX-I03', 'AFX-I06'],
  );
  assert.deepEqual(
    plan.deferred.map((item) => item.id),
    ['AFX-I09'],
  );
});

test('planSpinOff subtracts open sub-issues and skips already-spun items', () => {
  const existing = [
    { title: 'AFX-I01: Fix the chronic 30-min timeout', state: 'open' },
    { title: 'AFX-I03: deadline', state: 'closed', stateReason: 'completed' },
  ];
  const plan = planSpinOff({
    items: parseChecklist(UMBRELLA_BODY),
    existingSubIssues: existing,
    cap: 3,
  });
  assert.equal(plan.openCount, 1);
  assert.equal(plan.slots, 2);
  // AFX-I01 open, AFX-I03 spun (closed) — next candidates by priority.
  assert.deepEqual(
    plan.toCreate.map((item) => item.id),
    ['AFX-I06', 'AFX-I09'],
  );
});

test('planSpinOff creates nothing when the cap is filled', () => {
  const existing = [
    { title: 'AFX-I01: a', state: 'open' },
    { title: 'AFX-I03: b', state: 'open' },
    { title: 'AFX-I06: c', state: 'open' },
  ];
  const plan = planSpinOff({
    items: parseChecklist(UMBRELLA_BODY),
    existingSubIssues: existing,
    cap: 3,
  });
  assert.equal(plan.toCreate.length, 0);
  assert.deepEqual(
    plan.deferred.map((item) => item.id),
    ['AFX-I09'],
  );
});

test('subIssueTodoId reads the title prefix or the body marker', () => {
  assert.equal(subIssueTodoId({ title: 'AFX-I01: something' }), 'AFX-I01');
  assert.equal(
    subIssueTodoId({ title: 'other', body: subIssueMarker('MON-E10') }),
    'MON-E10',
  );
  assert.equal(subIssueTodoId({ title: 'plain bug' }), '');
});

// ---------------------------------------------------------------------------
// duplicateSubIssuesToClose — self-heal concurrent spin-off races
// ---------------------------------------------------------------------------
test('duplicateSubIssuesToClose flags the higher-numbered open duplicate', () => {
  const dupes = duplicateSubIssuesToClose([
    { number: 11, title: 'AFX-I01: a', state: 'open' },
    { number: 12, title: 'AFX-I01: a', state: 'open' },
    { number: 13, title: 'AFX-I03: b', state: 'open' },
  ]);
  assert.deepEqual(dupes, [
    { number: 12, todoId: 'AFX-I01', keepNumber: 11 },
  ]);
});

test('duplicateSubIssuesToClose dedups native+label overlap before grouping', () => {
  // Same issue appears in both the native sub-issue list and the label search.
  const dupes = duplicateSubIssuesToClose([
    { number: 11, title: 'AFX-I01: a', state: 'open' },
    { number: 11, title: 'AFX-I01: a', state: 'open' },
  ]);
  assert.deepEqual(dupes, []);
});

test('duplicateSubIssuesToClose ignores closed and ID-less issues', () => {
  const dupes = duplicateSubIssuesToClose([
    { number: 11, title: 'AFX-I01: a', state: 'open' },
    { number: 12, title: 'AFX-I01: a', state: 'closed', stateReason: 'completed' },
    { number: 14, title: 'free-form', state: 'open' },
  ]);
  assert.deepEqual(dupes, []);
});

test('duplicateSubIssuesToClose handles empty input', () => {
  assert.deepEqual(duplicateSubIssuesToClose([]), []);
  assert.deepEqual(duplicateSubIssuesToClose(undefined), []);
});

// ---------------------------------------------------------------------------
// tick + close
// ---------------------------------------------------------------------------
test('applyTicks ticks only completed, unchecked items', () => {
  const { body, ticked } = applyTicks(UMBRELLA_BODY, [
    'AFX-I01',
    'AFX-I02', // already checked — no double tick
    'AFX-I99', // unknown — ignored
  ]);
  assert.deepEqual(ticked, ['AFX-I01']);
  assert.ok(body.includes('- [x] AFX-I01 (P0)'));
  assert.ok(body.includes('- [ ] AFX-I03 (P1)'));
});

test('allItemsChecked requires every ID item ticked', () => {
  assert.equal(allItemsChecked(UMBRELLA_BODY), false);
  const { body } = applyTicks(UMBRELLA_BODY, [
    'AFX-I01',
    'AFX-I03',
    'AFX-I06',
    'AFX-I09',
  ]);
  assert.equal(allItemsChecked(body), true);
  assert.equal(allItemsChecked('no checklist here'), false);
});

test('isCompletedState matches closed+completed only', () => {
  assert.equal(
    isCompletedState({ state: 'closed', stateReason: 'completed' }),
    true,
  );
  assert.equal(
    isCompletedState({ state: 'closed', state_reason: 'completed' }),
    true,
  );
  assert.equal(
    isCompletedState({ state: 'closed', stateReason: 'not_planned' }),
    false,
  );
  assert.equal(isCompletedState({ state: 'open' }), false);
});

// ---------------------------------------------------------------------------
// sub-issue content building
// ---------------------------------------------------------------------------
test('buildSubIssueTitle strips cross-ref suffix and appends workflow', () => {
  const [item] = parseChecklist(
    '- [ ] AFX-I02 (P0) File a failure issue — XC-1',
  );
  assert.equal(
    buildSubIssueTitle(item, 'audit-fix'),
    'AFX-I02: File a failure issue (audit-fix)',
  );
});

test('extractWorkflowName parses the umbrella title', () => {
  assert.equal(
    extractWorkflowName(
      '[todo-backlog] audit-fix: optimize/audit review backlog (AFX)',
    ),
    'audit-fix',
  );
  assert.equal(extractWorkflowName('random title'), '');
});

test('buildSubIssueBody has marker, non-closing reference, and process note', () => {
  const [item] = parseChecklist(UMBRELLA_BODY);
  const body = buildSubIssueBody({
    item,
    umbrellaNumber: 678,
    docExcerpt: '| AFX-I01 | Fix the chronic 30-min timeout | P0 |',
  });
  assert.ok(body.includes(subIssueMarker('AFX-I01')));
  assert.ok(body.includes('Part of #678'));
  assert.ok(!/close[sd]?:?\s+#\d+/i.test(body));
  assert.ok(body.includes(item.line));
  assert.ok(body.includes('| AFX-I01 |'));
  assert.ok(body.includes('Reference **AFX-I01**'));
});

test('priorityLabel maps P0/P1 to high, P2 medium, P3 low', () => {
  assert.equal(priorityLabel(0), 'high');
  assert.equal(priorityLabel(1), 'high');
  assert.equal(priorityLabel(2), 'medium');
  assert.equal(priorityLabel(3), 'low');
});

test('extractDocExcerpt finds the TODO table row', () => {
  const doc = [
    '| ID | Title |',
    '| AFX-I01 | Fix the chronic 30-min timeout | P0 |',
  ].join('\n');
  assert.ok(extractDocExcerpt(doc, 'AFX-I01').startsWith('| AFX-I01 |'));
  assert.equal(extractDocExcerpt(doc, 'AFX-I99'), '');
  assert.equal(extractDocExcerpt('', 'AFX-I01'), '');
});
