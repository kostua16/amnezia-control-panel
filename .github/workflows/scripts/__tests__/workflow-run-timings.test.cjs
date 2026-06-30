/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  duplicateSameSha,
  secondsBetween,
  summarizeJob,
  summarizeStep,
  summarizeWorkflowRunTiming,
} = require('../workflow-run-timings.cjs');

// ── secondsBetween ──────────────────────────────────────────────

test('secondsBetween returns duration in seconds', () => {
  assert.equal(
    secondsBetween('2025-01-01T00:00:00Z', '2025-01-01T00:05:30Z'),
    330,
  );
});

test('secondsBetween rounds to nearest second', () => {
  assert.equal(
    secondsBetween('2025-01-01T00:00:00Z', '2025-01-01T00:00:00.499Z'),
    0,
  );
  assert.equal(
    secondsBetween('2025-01-01T00:00:00Z', '2025-01-01T00:00:01.500Z'),
    2,
  );
});

test('secondsBetween returns null for null inputs', () => {
  assert.equal(secondsBetween(null, '2025-01-01T00:00:10Z'), null);
  assert.equal(secondsBetween('2025-01-01T00:00:00Z', null), null);
  assert.equal(secondsBetween(null, null), null);
});

test('secondsBetween returns null when end is before start', () => {
  assert.equal(
    secondsBetween('2025-01-01T00:01:00Z', '2025-01-01T00:00:00Z'),
    null,
  );
});

test('secondsBetween returns null for empty strings', () => {
  assert.equal(secondsBetween('', '2025-01-01T00:00:10Z'), null);
  assert.equal(secondsBetween('2025-01-01T00:00:00Z', ''), null);
});

test('secondsBetween handles undefined inputs', () => {
  assert.equal(secondsBetween(undefined, undefined), null);
});

// ── summarizeStep ────────────────────────────────────────────────

test('summarizeStep extracts step fields', () => {
  const step = summarizeStep(
    {
      name: 'Checkout',
      status: 'completed',
      conclusion: 'success',
      started_at: '2025-01-01T00:00:00Z',
      completed_at: '2025-01-01T00:00:10Z',
    },
    'build',
  );

  assert.equal(step.name, 'Checkout');
  assert.equal(step.job, 'build');
  assert.equal(step.status, 'completed');
  assert.equal(step.conclusion, 'success');
  assert.equal(step.durationSec, 10);
});

test('summarizeStep uses camelCase fallbacks', () => {
  const step = summarizeStep(
    {
      name: 'Build',
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:02:00Z',
    },
    'ci',
  );

  assert.equal(step.durationSec, 120);
});

test('summarizeStep defaults missing fields', () => {
  const step = summarizeStep({}, 'job-x');
  assert.equal(step.name, '');
  assert.equal(step.job, 'job-x');
  assert.equal(step.status, '');
  assert.equal(step.conclusion, '');
  assert.equal(step.durationSec, null);
});

test('summarizeStep handles undefined input', () => {
  const step = summarizeStep(undefined, 'default-job');
  assert.equal(step.durationSec, null);
});

// ── summarizeJob ─────────────────────────────────────────────────

test('summarizeJob extracts job-level timing', () => {
  const job = summarizeJob({
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    runner_name: 'linux-self-hosted',
    runner_group_name: 'default',
    created_at: '2025-01-01T00:00:00Z',
    started_at: '2025-01-01T00:00:05Z',
    completed_at: '2025-01-01T00:01:00Z',
    steps: [],
  });

  assert.equal(job.name, 'build');
  assert.equal(job.queueSec, 5);
  assert.equal(job.durationSec, 55);
  assert.equal(job.runnerName, 'linux-self-hosted');
  assert.deepEqual(job.topSlowSteps, []);
});

test('summarizeJob picks top slow steps', () => {
  const job = summarizeJob({
    name: 'test',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    steps: [
      {
        name: 'fast',
        started_at: '2025-01-01T00:00:00Z',
        completed_at: '2025-01-01T00:00:01Z',
      },
      {
        name: 'slow',
        started_at: '2025-01-01T00:00:01Z',
        completed_at: '2025-01-01T00:00:30Z',
      },
      {
        name: 'slowest',
        started_at: '2025-01-01T00:00:30Z',
        completed_at: '2025-01-01T00:01:00Z',
      },
    ],
  });

  assert.equal(job.topSlowSteps.length, 3);
  assert.equal(job.topSlowSteps[0].name, 'slowest');
  assert.equal(job.topSlowSteps[0].durationSec, 30);
  assert.equal(job.topSlowSteps[1].name, 'slow');
  assert.equal(job.topSlowSteps[2].name, 'fast');
});

test('summarizeJob skips steps with null duration in ranking', () => {
  const job = summarizeJob({
    name: 'mixed',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    steps: [
      { name: 'no-timing' },
      {
        name: 'timed',
        started_at: '2025-01-01T00:00:00Z',
        completed_at: '2025-01-01T00:00:10Z',
      },
    ],
  });

  assert.equal(job.topSlowSteps.length, 1);
  assert.equal(job.topSlowSteps[0].name, 'timed');
});

test('summarizeJob handles undefined input', () => {
  const job = summarizeJob(undefined);
  assert.equal(job.name, '');
  assert.equal(job.durationSec, null);
  assert.deepEqual(job.topSlowSteps, []);
});

test('summarizeJob caps top slow steps at 5', () => {
  const job = summarizeJob({
    name: 'long-job',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:10:00Z',
    steps: Array.from({ length: 8 }, (_, i) => ({
      name: `step-${i}`,
      started_at: '2025-01-01T00:00:00Z',
      completed_at: `2025-01-01T00:00:${10 + i}Z`,
    })),
  });

  assert.equal(job.topSlowSteps.length, 5);
});

// ── summarizeWorkflowRunTiming ──────────────────────────────────

test('summarizeWorkflowRunTiming returns job summaries and top slow steps', () => {
  const result = summarizeWorkflowRunTiming({
    jobs: [
      {
        name: 'build',
        started_at: '2025-01-01T00:00:00Z',
        completed_at: '2025-01-01T00:02:00Z',
        runner_name: 'runner-1',
        steps: [
          {
            name: 'compile',
            started_at: '2025-01-01T00:00:00Z',
            completed_at: '2025-01-01T00:01:30Z',
          },
        ],
      },
      {
        name: 'test',
        started_at: '2025-01-01T00:02:00Z',
        completed_at: '2025-01-01T00:05:00Z',
        runner_name: 'runner-2',
        steps: [
          {
            name: 'unit',
            started_at: '2025-01-01T00:02:00Z',
            completed_at: '2025-01-01T00:02:10Z',
          },
          {
            name: 'integration',
            started_at: '2025-01-01T00:02:10Z',
            completed_at: '2025-01-01T00:04:50Z',
          },
        ],
      },
    ],
  });

  assert.equal(result.jobs.length, 2);
  assert.equal(result.topSlowSteps[0].name, 'integration');
  assert.equal(result.topSlowSteps[0].durationSec, 160);
  assert.equal(result.topSlowSteps[0].job, 'test');
  assert.equal(result.topSlowSteps[1].name, 'compile');
  assert.equal(result.topSlowSteps[1].durationSec, 90);
});

test('summarizeWorkflowRunTiming handles empty jobs array', () => {
  const result = summarizeWorkflowRunTiming({ jobs: [] });
  assert.equal(result.jobs.length, 0);
  assert.deepEqual(result.topSlowSteps, []);
});

test('summarizeWorkflowRunTiming handles undefined input', () => {
  const result = summarizeWorkflowRunTiming();
  assert.equal(result.jobs.length, 0);
  assert.deepEqual(result.topSlowSteps, []);
});

test('summarizeWorkflowRunTiming caps top slow steps globally at 5', () => {
  const jobs = Array.from({ length: 3 }, (_, i) => ({
    name: `job-${i}`,
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:03:00Z',
    runner_name: 'runner',
    steps: Array.from({ length: 3 }, (_, j) => ({
      name: `step-${i}-${j}`,
      started_at: '2025-01-01T00:00:00Z',
      completed_at: `2025-01-01T00:00:${10 + i * 3 + j}Z`,
    })),
  }));

  const result = summarizeWorkflowRunTiming({ jobs });
  assert.equal(result.topSlowSteps.length, 5);
});

// ── duplicateSameSha ──────────────────────────────────────────────

test('duplicateSameSha returns null for single run', () => {
  const run = { id: 1, name: 'CI', head_sha: 'abc123' };
  assert.equal(duplicateSameSha(run, [run]), null);
});

test('duplicateSameSha returns null when no duplicate SHA exists', () => {
  const run1 = { id: 1, name: 'CI', head_sha: 'sha-a' };
  const run2 = { id: 2, name: 'CI', head_sha: 'sha-b' };
  assert.equal(duplicateSameSha(run1, [run1, run2]), null);
});

test('duplicateSameSha detects same-SHA duplicates across same workflow', () => {
  const run1 = {
    id: 1,
    name: 'CI',
    head_sha: 'same-sha',
    created_at: '2025-01-01T01:00:00Z',
  };
  const run2 = {
    id: 2,
    name: 'CI',
    head_sha: 'same-sha',
    created_at: '2025-01-01T02:00:00Z',
  };
  const run3 = {
    id: 3,
    name: 'CI',
    head_sha: 'same-sha',
    created_at: '2025-01-01T03:00:00Z',
  };

  const result = duplicateSameSha(run1, [run1, run2, run3]);
  assert.ok(result);
  assert.equal(result.headSha, 'same-sha');
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.totalSameShaRuns, 3);
  assert.equal(result.runs.length, 2);
});

test('duplicateSameSha ignores duplicates from different workflow names', () => {
  const run1 = { id: 1, name: 'CI', head_sha: 'sha-x' };
  const run2 = { id: 2, name: 'PR Policy', head_sha: 'sha-x' };
  assert.equal(duplicateSameSha(run1, [run1, run2]), null);
});

test('duplicateSameSha handles snake_case and camelCase head_sha', () => {
  const run1 = {
    id: 1,
    name: 'CI',
    headSha: 'sha-camel',
    created_at: '2025-01-01T01:00:00Z',
  };
  const run2 = {
    id: 2,
    name: 'CI',
    head_sha: 'sha-camel',
    created_at: '2025-01-01T02:00:00Z',
  };

  const result = duplicateSameSha(run1, [run1, run2]);
  assert.ok(result);
  assert.equal(result.headSha, 'sha-camel');
});

test('duplicateSameSha returns null when head_sha is missing', () => {
  const run = { id: 1, name: 'CI' };
  assert.equal(duplicateSameSha(run, [run]), null);
});

test('duplicateSameSha returns null for undefined run', () => {
  assert.equal(duplicateSameSha(undefined, []), null);
});

test('duplicateSameSha caps duplicate run summaries at 5', () => {
  const base = {
    id: 0,
    name: 'CI',
    head_sha: 'dup',
    created_at: '2025-01-01T00:00:00Z',
  };
  const duplicates = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: 'CI',
    head_sha: 'dup',
    created_at: `2025-01-01T0${i}:00:00Z`,
  }));

  const result = duplicateSameSha(base, [base, ...duplicates]);
  assert.ok(result);
  assert.equal(result.runs.length, 5);
  assert.equal(result.duplicateCount, 8);
});
