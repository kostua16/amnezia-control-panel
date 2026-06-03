#!/usr/bin/env node

const MAX_TOP_STEPS = 5;
const MAX_DUPLICATE_RUNS = 5;

function field(source, snakeName, camelName = snakeName) {
  if (!source || typeof source !== 'object') return undefined;
  return source[snakeName] ?? source[camelName];
}

function timestampMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function secondsBetween(startedAt, completedAt) {
  const startMs = timestampMs(startedAt);
  const endMs = timestampMs(completedAt);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 1000);
}

function summarizeStep(step = {}, jobName = '') {
  const startedAt = field(step, 'started_at', 'startedAt');
  const completedAt = field(step, 'completed_at', 'completedAt');
  return {
    name: step.name || '',
    job: jobName,
    status: step.status || '',
    conclusion: step.conclusion || '',
    startedAt,
    completedAt,
    durationSec: secondsBetween(startedAt, completedAt),
  };
}

function summarizeJob(job = {}) {
  const createdAt = field(job, 'created_at', 'createdAt');
  const startedAt = field(job, 'started_at', 'startedAt');
  const completedAt = field(job, 'completed_at', 'completedAt');
  const steps = (job.steps || []).map((step) => summarizeStep(step, job.name));
  const topSlowSteps = steps
    .filter((step) => step.durationSec !== null)
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, MAX_TOP_STEPS);

  return {
    name: job.name || '',
    status: job.status || '',
    conclusion: job.conclusion || '',
    runnerName: field(job, 'runner_name', 'runnerName') || '',
    runnerGroupName: field(job, 'runner_group_name', 'runnerGroupName') || '',
    createdAt,
    startedAt,
    completedAt,
    queueSec: secondsBetween(createdAt, startedAt),
    durationSec: secondsBetween(startedAt, completedAt),
    topSlowSteps,
  };
}

function summarizeWorkflowRunTiming({ jobs = [] } = {}) {
  const jobSummaries = jobs.map((job) => summarizeJob(job));
  const topSlowSteps = jobSummaries
    .flatMap((job) =>
      job.topSlowSteps.map((step) => ({
        job: job.name,
        runnerName: job.runnerName,
        name: step.name,
        conclusion: step.conclusion,
        durationSec: step.durationSec,
      })),
    )
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, MAX_TOP_STEPS);

  return {
    jobs: jobSummaries,
    topSlowSteps,
  };
}

function runStartedAt(run = {}) {
  return field(run, 'run_started_at', 'runStartedAt') || run.created_at;
}

function runSummary(run = {}) {
  return {
    name: run.name || '',
    runNumber: field(run, 'run_number', 'runNumber'),
    status: run.status || '',
    conclusion: run.conclusion || '',
    event: run.event || '',
    headBranch: field(run, 'head_branch', 'headBranch') || '',
    createdAt: run.created_at,
    runStartedAt: runStartedAt(run),
    runUpdatedAt: run.updated_at,
    durationSec: secondsBetween(runStartedAt(run), run.updated_at),
    url: field(run, 'html_url', 'htmlUrl') || '',
  };
}

function duplicateSameSha(run = {}, runs = []) {
  const headSha = field(run, 'head_sha', 'headSha');
  if (!headSha) return null;

  const duplicates = runs
    .filter((candidate) => {
      if (!candidate || candidate.id === run.id) return false;
      return (
        candidate.name === run.name &&
        field(candidate, 'head_sha', 'headSha') === headSha
      );
    })
    .sort(
      (a, b) =>
        (timestampMs(b.created_at) || 0) - (timestampMs(a.created_at) || 0),
    );

  if (duplicates.length === 0) return null;

  return {
    headSha,
    duplicateCount: duplicates.length,
    totalSameShaRuns: duplicates.length + 1,
    runs: duplicates.slice(0, MAX_DUPLICATE_RUNS).map(runSummary),
  };
}

module.exports = {
  duplicateSameSha,
  secondsBetween,
  summarizeJob,
  summarizeStep,
  summarizeWorkflowRunTiming,
};
