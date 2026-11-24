/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  format,
  parseLine,
  parseRestCount,
  summarize,
} = require('../summarize-rate-limit.cjs');

test('aggregates REST counts by workflow and job across attempts and matrix reports', () => {
  const count = (workflow, job, run, total, graphql, byRoute) =>
    `2026-11-24T00:00:00Z REST_COUNT workflow=${JSON.stringify(workflow)} job=${job} run=${run} total=${total} graphql=${graphql} by_route=${JSON.stringify(byRoute)}`;
  const pull = 'GET /repos/:o/:r/pulls/:n';
  const issue = 'POST /repos/:o/:r/issues';
  const summary = summarize([
    count('Workflow "test"', 'check', '12.1', 2, 1, { [pull]: 2 }),
    count('Workflow "test"', 'check', '12.1', 1, 0, { [issue]: 1 }),
    count('Workflow "test"', 'check', '12.2', 1, 2, { [pull]: 1 }),
    count('Workflow "test"', 'other', '12.2', 0, 2, {}),
    count('Another workflow', 'check', '13.1', 1, 0, { [pull]: 1 }),
    count('Another workflow', 'check', '14.1', 9, 0, { [pull]: 1 }),
    'REST_COUNT workflow="truncated" job=job run=12.1 total=1 graphql=0 by_route={',
  ]);
  assert.equal(summary.restCounts.length, 3);
  const group = summary.restCounts.find(
    (row) => row.workflow === 'Workflow "test"' && row.job === 'check',
  );
  assert.equal(group.runs.size, 2);
  assert.equal(group.reports, 3);
  assert.equal(group.total, 4);
  assert.equal(group.graphql, 3);
  assert.deepEqual(Object.fromEntries(group.routes), { [pull]: 3, [issue]: 1 });
  assert.match(
    format(summary),
    /job=check runs=2 reports=3 total=4 graphql=3 by_route=/,
  );
  assert.equal(
    parseRestCount(count('Workflow', 'job', '1.1', 0, 0, {})).total,
    0,
  );
});

function line({
  phase,
  job = 'orchestrate',
  run = '1.1',
  id,
  remaining,
  reset,
}) {
  return (
    `2026-11-22T19:56:25Z RATE_LIMIT phase=${phase} workflow="PR Orchestrator" job=${job} ` +
    `label=${job} run=${run} event=issue_comment token=ghs token_id=${id} ` +
    `core_remaining=${remaining}/5000 core_reset=${reset} graphql=4919/5000`
  );
}

test('parses a RATE_LIMIT line behind a log prefix and ignores other lines', () => {
  const parsed = parseLine(
    line({
      phase: 'job-start',
      id: 'aaaa1111',
      remaining: 4124,
      reset: '2026-11-22T20:39:11Z',
    }),
  );
  assert.equal(parsed.workflow, 'PR Orchestrator');
  assert.equal(parsed.remaining, 4124);
  assert.equal(parsed.limit, 5000);
  assert.equal(parsed.token_id, 'aaaa1111');
  assert.equal(parseLine('some other log line'), null);
  assert.equal(parseLine('RATE_LIMIT phase=x core_remaining=n/a'), null);
});

test('groups readings by quota window and reports the span of remaining', () => {
  const summary = summarize([
    line({
      phase: 'job-start',
      id: 'a',
      remaining: 4400,
      reset: '2026-11-22T20:39:11Z',
    }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'a',
      remaining: 4100,
      reset: '2026-11-22T20:39:11Z',
    }),
    line({
      phase: 'job-start',
      run: '3.1',
      id: 'b',
      remaining: 4700,
      reset: '2026-11-22T20:41:57Z',
    }),
  ]);

  assert.equal(summary.windows.length, 2);
  const r1 = summary.windows.find((w) => w.reset === '2026-11-22T20:39:11Z');
  assert.equal(r1.max - r1.min, 300);
  assert.match(format(summary), /remaining 4400 -> 4100 of 5000 \(>= 300 used/);
});

test('flags jobs whose end reading comes from another window or token', () => {
  const summary = summarize([
    line({
      phase: 'job-start',
      id: 'a',
      remaining: 4300,
      reset: '2026-11-22T20:39:11Z',
    }),
    line({
      phase: 'job-end',
      id: 'b',
      remaining: 4700,
      reset: '2026-11-22T20:41:57Z',
    }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'a',
      remaining: 4300,
      reset: '2026-11-22T20:39:11Z',
    }),
    line({
      phase: 'job-end',
      run: '2.1',
      id: 'a',
      remaining: 4250,
      reset: '2026-11-22T20:39:11Z',
    }),
  ]);

  assert.equal(summary.jobsWithBoth, 2);
  assert.equal(summary.mismatched.length, 1);
  assert.match(
    format(summary),
    /PR Orchestrator \/ orchestrate: start reset=2026-11-22T20:39:11Z/,
  );
});

test('leaves readings without a usable window out of the windows', () => {
  const summary = summarize([
    line({
      phase: 'job-start',
      id: 'a',
      remaining: 4300,
      reset: '2026-11-22T20:39:11Z',
    }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'a',
      remaining: 100,
      reset: 'n/a',
    }),
    // truncated line: no core_reset field at all
    'RATE_LIMIT phase=job-start workflow="X" job=j label=j run=3.1 core_remaining=50/5000',
  ]);

  assert.equal(summary.readings, 3);
  assert.equal(summary.withoutWindow, 2);
  assert.equal(summary.windows.length, 1);
  assert.equal(summary.windows[0].min, 4300);
  assert.doesNotThrow(() => format(summary));
  assert.match(format(summary), /2 without a quota window/);
});

test('keeps separate start/end pairs of one job apart by label', () => {
  const at = '2026-11-22T20:39:11Z';
  const other = '2026-11-22T20:41:57Z';
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4300, reset: at }),
    line({ phase: 'job-end', id: 'a', remaining: 4200, reset: at }),
    line({
      phase: 'job-start',
      job: 'orchestrate',
      id: 'b',
      remaining: 4600,
      reset: other,
    }).replace('label=orchestrate', 'label=setup-environment'),
    line({
      phase: 'job-end',
      job: 'orchestrate',
      id: 'b',
      remaining: 4590,
      reset: other,
    }).replace('label=orchestrate', 'label=setup-environment'),
  ]);

  assert.equal(summary.jobsWithBoth, 2);
  assert.equal(summary.mismatched.length, 0);
});

test('pairs repeated same-label invocations like nested calls (last in, first out)', () => {
  const at = '2026-11-22T20:39:11Z';
  const other = '2026-11-22T20:41:57Z';
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4300, reset: at }),
    line({ phase: 'job-start', id: 'b', remaining: 4700, reset: other }),
    // post steps run in reverse order: the inner invocation ends first
    line({ phase: 'job-end', id: 'b', remaining: 4690, reset: other }),
    line({ phase: 'job-end', id: 'a', remaining: 4200, reset: at }),
  ]);

  assert.equal(summary.jobsWithBoth, 2);
  assert.equal(summary.mismatched.length, 0);
});

test('still flags a same-label pair whose end reads another window', () => {
  const at = '2026-11-22T20:39:11Z';
  const other = '2026-11-22T20:41:57Z';
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4300, reset: at }),
    line({ phase: 'job-start', id: 'a', remaining: 4290, reset: at }),
    line({ phase: 'job-end', id: 'a', remaining: 4200, reset: at }),
    line({ phase: 'job-end', id: 'b', remaining: 4700, reset: other }),
  ]);

  assert.equal(summary.jobsWithBoth, 2);
  assert.equal(summary.mismatched.length, 1);
});

test('pools all tokens of one quota bucket into a single window row', () => {
  const at = '2026-11-22T20:39:11Z';
  const tagged = (id, remaining, run) =>
    line({ phase: 'job-start', run, id, remaining, reset: at });
  const legacy =
    'RATE_LIMIT phase=job-start workflow="X" job=j label=j run=9.1 token=ghs core_remaining=4000/5000 core_reset=' +
    at;
  const summary = summarize([
    tagged('aaa', 4500, '1.1'),
    tagged('bbb', 4400, '2.1'),
    tagged('ccc', 4300, '3.1'),
    legacy,
  ]);

  assert.equal(summary.windows.length, 1);
  assert.equal(summary.windows[0].tokens.size, 3);
  assert.equal(summary.windows[0].readings, 4);
  assert.equal(summary.windows[0].max - summary.windows[0].min, 500);
  assert.equal(summary.windows[0].tagged, 3);
  assert.ok(
    format(summary).includes(
      '4 readings, 3 with token_id from 3 distinct tokens',
    ),
  );
});

test('skips a label group whose start and end counts differ instead of guessing', () => {
  const at = '2026-11-22T20:39:11Z';
  const other = '2026-11-22T20:41:57Z';
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4300, reset: at }),
    // inner invocation lost its end reading: only one end for two starts
    line({ phase: 'job-start', id: 'a', remaining: 4290, reset: at }),
    line({ phase: 'job-end', id: 'b', remaining: 4700, reset: other }),
  ]);

  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.jobsWithBoth, 0);
  assert.equal(summary.mismatched.length, 0);
  const report = format(summary);
  assert.ok(
    report.includes('skipped label groups (unequal start/end counts): 1'),
  );
  assert.ok(
    report.includes(
      'skipped PR Orchestrator / orchestrate (label orchestrate, run 1.1): 2 starts, 1 ends',
    ),
  );
});

test('renders missing identity fields as a dash in the skipped list', () => {
  const summary = summarize([
    'RATE_LIMIT phase=job-start core_remaining=50/5000 core_reset=2026-11-22T20:39:11Z',
  ]);

  assert.equal(summary.ambiguous, 1);
  const report = format(summary);
  assert.ok(
    report.includes('skipped - / - (label -, run -): 1 starts, 0 ends'),
  );
  assert.ok(!report.includes('undefined'));
});

test('keeps buckets of different token kinds apart even on the same reset second', () => {
  const at = '2026-11-22T20:39:11Z';
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4000, reset: at }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'b',
      remaining: 100,
      reset: at,
    }).replace('token=ghs', 'token=ghp'),
  ]);

  assert.equal(summary.windows.length, 2);
  assert.deepEqual(summary.windows.map((w) => w.kind).sort(), ['ghp', 'ghs']);
});
