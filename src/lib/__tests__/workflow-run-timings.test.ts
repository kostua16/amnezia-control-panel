import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

type WorkflowRunTimingHelper = {
  duplicateSameSha: (run: unknown, runs: unknown[]) => unknown;
  secondsBetween: (startedAt: string, completedAt: string) => number | null;
  summarizeWorkflowRunTiming: (input: { jobs: unknown[] }) => {
    jobs: Array<{
      name: string;
      runnerName: string;
      queueSec: number | null;
      durationSec: number | null;
      topSlowSteps: Array<{ name: string; durationSec: number | null }>;
    }>;
    topSlowSteps: Array<{
      job: string;
      runnerName: string;
      name: string;
      durationSec: number | null;
    }>;
  };
};

const { duplicateSameSha, secondsBetween, summarizeWorkflowRunTiming } =
  require(
    path.join(repoRoot, '.github/workflows/scripts/workflow-run-timings.cjs'),
  ) as WorkflowRunTimingHelper;

describe('workflow run timing helpers', () => {
  it('calculates whole-second durations and ignores invalid ranges', () => {
    assert.equal(
      secondsBetween('2026-06-03T12:00:00Z', '2026-06-03T12:01:31Z'),
      91,
    );
    assert.equal(
      secondsBetween('2026-06-03T12:01:31Z', '2026-06-03T12:00:00Z'),
      null,
    );
  });

  it('summarizes job queue time, runner, duration, and slowest steps', () => {
    const summary = summarizeWorkflowRunTiming({
      jobs: [
        {
          name: 'Build',
          status: 'completed',
          conclusion: 'success',
          runner_name: 'self-hosted-big-1',
          created_at: '2026-06-03T12:00:00Z',
          started_at: '2026-06-03T12:00:45Z',
          completed_at: '2026-06-03T12:10:45Z',
          steps: [
            {
              name: 'Checkout',
              conclusion: 'success',
              started_at: '2026-06-03T12:00:45Z',
              completed_at: '2026-06-03T12:01:05Z',
            },
            {
              name: 'Compile',
              conclusion: 'success',
              started_at: '2026-06-03T12:01:05Z',
              completed_at: '2026-06-03T12:09:35Z',
            },
            {
              name: 'Upload artifact',
              conclusion: 'success',
              started_at: '2026-06-03T12:09:35Z',
              completed_at: '2026-06-03T12:10:45Z',
            },
          ],
        },
      ],
    });

    assert.equal(summary.jobs[0].runnerName, 'self-hosted-big-1');
    assert.equal(summary.jobs[0].queueSec, 45);
    assert.equal(summary.jobs[0].durationSec, 600);
    assert.deepEqual(
      summary.topSlowSteps.map((step) => step.name),
      ['Compile', 'Upload artifact', 'Checkout'],
    );
    assert.equal(summary.topSlowSteps[0].job, 'Build');
  });

  it('reports same-workflow same-SHA duplicate run hints', () => {
    const currentRun = {
      id: 3,
      name: 'CI',
      head_sha: 'abc123',
      head_branch: 'feature',
      run_number: 103,
      conclusion: 'success',
      created_at: '2026-06-03T12:20:00Z',
      run_started_at: '2026-06-03T12:20:10Z',
      updated_at: '2026-06-03T12:25:00Z',
    };
    const duplicate = duplicateSameSha(currentRun, [
      {
        id: 1,
        name: 'CI',
        head_sha: 'abc123',
        head_branch: 'feature',
        run_number: 101,
        conclusion: 'success',
        created_at: '2026-06-03T12:00:00Z',
        run_started_at: '2026-06-03T12:00:10Z',
        updated_at: '2026-06-03T12:05:00Z',
      },
      {
        id: 2,
        name: 'Code Review',
        head_sha: 'abc123',
        run_number: 102,
        conclusion: 'success',
      },
      currentRun,
    ]) as {
      duplicateCount: number;
      totalSameShaRuns: number;
      runs: Array<{ name: string; runNumber: number }>;
    };

    assert.equal(duplicate.duplicateCount, 1);
    assert.equal(duplicate.totalSameShaRuns, 2);
    assert.deepEqual(duplicate.runs, [
      {
        name: 'CI',
        runNumber: 101,
        status: '',
        conclusion: 'success',
        event: '',
        headBranch: 'feature',
        createdAt: '2026-06-03T12:00:00Z',
        runStartedAt: '2026-06-03T12:00:10Z',
        runUpdatedAt: '2026-06-03T12:05:00Z',
        durationSec: 290,
        url: '',
      },
    ]);
  });

  it('returns null when no same-workflow same-SHA duplicate exists', () => {
    assert.equal(
      duplicateSameSha({ id: 1, name: 'CI', head_sha: 'abc123' }, [
        { id: 2, name: 'CI', head_sha: 'def456' },
      ]),
      null,
    );
  });
});
