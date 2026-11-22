/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { format, parseLine, summarize } = require('../summarize-rate-limit.cjs');

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
    }).replace('R1', '2026-11-22T20:39:11Z'),
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
