/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cronToMinuteSlots,
  expandField,
  minDriftMinutes,
  parseSince,
} = require('../detect-schedule-drift.cjs');

// ── expandField ──────────────────────────────────────────────

test('expandField handles wildcard', () => {
  const result = expandField('*', 0, 59);
  assert.deepEqual(result, Array.from({ length: 60 }, (_, i) => i));
});

test('expandField handles single value', () => {
  assert.deepEqual(expandField('17', 0, 59), [17]);
});

test('expandField handles range', () => {
  assert.deepEqual(expandField('6-8', 0, 23), [6, 7, 8]);
});

test('expandField handles list', () => {
  assert.deepEqual(expandField('7,22,37,52', 0, 59), [7, 22, 37, 52]);
});

test('expandField handles step', () => {
  assert.deepEqual(expandField('*/15', 0, 59), [0, 15, 30, 45]);
});

test('expandField handles step with non-zero base', () => {
  assert.deepEqual(expandField('*/6', 0, 23), [0, 6, 12, 18]);
});

test('expandField ignores out-of-range values', () => {
  assert.deepEqual(expandField('25', 0, 23), []);
});

// ── cronToMinuteSlots ───────────────────────────────────────

test('cronToMinuteSlots: single fixed schedule', () => {
  // '17 6 * * 1' → 6*60+17 = 377
  const slots = cronToMinuteSlots('17 6 * * 1');
  assert.deepEqual(slots, [377]);
});

test('cronToMinuteSlots: twice daily', () => {
  // '41 6,18 * * *' → 6*60+41=401, 18*60+41=1121
  const slots = cronToMinuteSlots('41 6,18 * * *');
  assert.deepEqual(slots, [401, 1121]);
});

test('cronToMinuteSlots: every hour at :07', () => {
  const slots = cronToMinuteSlots('7 * * * *');
  assert.equal(slots.length, 24);
  assert.equal(slots[0], 7);    // 00:07
  assert.equal(slots[1], 67);   // 01:07
  assert.equal(slots[23], 1387); // 23:07
});

test('cronToMinuteSlots: every 3 hours at :17', () => {
  const slots = cronToMinuteSlots('17 */3 * * *');
  assert.deepEqual(slots, [17, 197, 377, 557, 737, 917, 1097, 1277]);
});

test('cronToMinuteSlots: every 10 minutes', () => {
  const slots = cronToMinuteSlots('*/10 * * * *');
  assert.equal(slots.length, 144);
  assert.equal(slots[0], 0);
  assert.equal(slots[1], 10);
  assert.equal(slots[143], 1430);
});

test('cronToMinuteSlots: multi-value minutes every hour', () => {
  // 4 minute values × 24 hours = 96 slots
  const slots = cronToMinuteSlots('7,22,37,52 * * * *');
  assert.equal(slots.length, 96);
  assert.deepEqual(slots.slice(0, 4), [7, 22, 37, 52]); // hour 0
  assert.equal(slots[4], 67); // 01:07
});

test('cronToMinuteSlots: hourly at :37', () => {
  const slots = cronToMinuteSlots('37 * * * *');
  assert.equal(slots.length, 24);
  assert.equal(slots[0], 37);
});

// ── minDriftMinutes ──────────────────────────────────────────

test('minDriftMinutes: exact match', () => {
  const slots = [377]; // 06:17
  assert.equal(minDriftMinutes(slots, 377), 0);
});

test('minDriftMinutes: 30min drift', () => {
  const slots = [377]; // 06:17
  assert.equal(minDriftMinutes(slots, 407), 30); // 06:47
});

test('minDriftMinutes: 5h drift', () => {
  const slots = [377]; // 06:17
  assert.equal(minDriftMinutes(slots, 677), 300); // 11:17
});

test('minDriftMinutes: 6h drift', () => {
  const slots = [377]; // 06:17
  assert.equal(minDriftMinutes(slots, 737), 360); // 12:17
});

test('minDriftMinutes: wrap-around midnight', () => {
  const slots = [1380]; // 23:00
  // actual 00:30 = 30 minutes
  // forward: |1380 - 30| = 1350
  // backward: 1440 - 1350 = 90
  assert.equal(minDriftMinutes(slots, 30), 90);
});

test('minDriftMinutes: picks nearest slot from multiple', () => {
  const slots = [401, 1121]; // 06:41 and 18:41
  // actual 07:00 = 420 → drift from 401 = 19, from 1121 = 701
  assert.equal(minDriftMinutes(slots, 420), 19);
});

test('minDriftMinutes: empty slots returns null', () => {
  assert.equal(minDriftMinutes([], 100), null);
});

// ── parseSince ───────────────────────────────────────────────

test('parseSince default (7d)', () => {
  const cutoff = parseSince('7d');
  const expected = Date.now() - 7 * 86400000;
  const diff = Math.abs(cutoff.getTime() - expected);
  assert.ok(diff < 1000, `expected ~${expected}, got ${cutoff.getTime()}`);
});

test('parseSince hours', () => {
  const cutoff = parseSince('12h');
  const expected = Date.now() - 12 * 3600000;
  const diff = Math.abs(cutoff.getTime() - expected);
  assert.ok(diff < 1000);
});

test('parseSince invalid returns 7d default', () => {
  const cutoff = parseSince('invalid');
  const expected = Date.now() - 7 * 86400000;
  const diff = Math.abs(cutoff.getTime() - expected);
  assert.ok(diff < 1000);
});

// ── Integration: real-world cron patterns ───────────────────

test('maintenance workflow cron produces correct slots', () => {
  // '41 6,18 * * *' → twice daily
  const slots = cronToMinuteSlots('41 6,18 * * *');
  assert.deepEqual(slots, [401, 1121]);

  // Simulate a run at 06:41 UTC (exact) → 0 drift
  assert.equal(minDriftMinutes(slots, 401), 0);

  // Simulate a run at 07:00 UTC → 19 min drift
  assert.equal(minDriftMinutes(slots, 420), 19);

  // Simulate a run at 12:41 UTC (6h off from 06:41) → 360 min drift
  assert.equal(minDriftMinutes(slots, 761), 360);
});

test('security-audit-weekly cron detects 5h drift', () => {
  // '17 6 * * 1' → Monday 06:17 UTC (slot 377)
  const slots = cronToMinuteSlots('17 6 * * 1');
  assert.deepEqual(slots, [377]);

  // Evidence from TODOs-2.md: actual starts were 11:01, 11:23, 12:25
  const drift11_01 = minDriftMinutes(slots, 11 * 60 + 1);   // 661
  const drift11_23 = minDriftMinutes(slots, 11 * 60 + 23);  // 683
  const drift12_25 = minDriftMinutes(slots, 12 * 60 + 25);  // 745

  // All should be > 4.5 hours (270 min)
  assert.ok(drift11_01 > 270, `11:01 drift ${drift11_01}min should exceed 270min`);
  assert.ok(drift11_23 > 270, `11:23 drift ${drift11_23}min should exceed 270min`);
  assert.ok(drift12_25 > 270, `12:25 drift ${drift12_25}min should exceed 270min`);

  // Median of those three: (683+745)/2 = 714 min ≈ 11.9h
  const sorted = [drift11_01, drift11_23, drift12_25].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  assert.ok(median / 60 >= 2, `median drift ${median / 60}h should be >= 2h threshold`);
});
