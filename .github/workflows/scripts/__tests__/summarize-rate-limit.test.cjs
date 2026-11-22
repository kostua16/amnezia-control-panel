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
    line({ phase: 'job-start', id: 'aaaa1111', remaining: 4124, reset: 'R1' }),
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
    line({ phase: 'job-start', id: 'a', remaining: 4400, reset: 'R1' }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'a',
      remaining: 4100,
      reset: 'R1',
    }),
    line({
      phase: 'job-start',
      run: '3.1',
      id: 'b',
      remaining: 4700,
      reset: 'R2',
    }),
  ]);

  assert.equal(summary.windows.length, 2);
  const r1 = summary.windows.find((w) => w.reset === 'R1');
  assert.equal(r1.max - r1.min, 300);
  assert.match(format(summary), /remaining 4400 -> 4100 of 5000 \(>= 300 used/);
});

test('flags jobs whose end reading comes from another window or token', () => {
  const summary = summarize([
    line({ phase: 'job-start', id: 'a', remaining: 4300, reset: 'R1' }),
    line({ phase: 'job-end', id: 'b', remaining: 4700, reset: 'R2' }),
    line({
      phase: 'job-start',
      run: '2.1',
      id: 'a',
      remaining: 4300,
      reset: 'R1',
    }),
    line({
      phase: 'job-end',
      run: '2.1',
      id: 'a',
      remaining: 4250,
      reset: 'R1',
    }),
  ]);

  assert.equal(summary.jobsWithBoth, 2);
  assert.equal(summary.mismatched.length, 1);
  assert.match(
    format(summary),
    /PR Orchestrator \/ orchestrate: start reset=R1/,
  );
});
