/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every job step that uses a local action
// (`uses: ./.github/actions/*`) must have a preceding `actions/checkout@`
// step in the same job. A local action cannot be resolved before the
// repository exists in the workspace, and because dependent jobs guard on
// gate outputs without `always()`, an unresolved gate silently skips the
// whole workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

/**
 * Parse a workflow YAML into per-job step arrays.
 * Uses regex scanning (no YAML dependency) consistent with other e2e tests.
 *
 * Returns { jobName: { name, steps: [{ uses?, name? }] } }
 */
function parseWorkflowJobs(content) {
  const jobs = {};
  const lines = content.split('\n');
  // Collect all top-level job keys: lines matching "  <name>:" where
  // the next non-empty line is indented >=4 spaces (i.e. a mapping block).
  const jobRanges = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^  (\S+):\s*$/);
    if (!m) continue;
    const name = m[1];
    if (
      [
        'on',
        'permissions',
        'concurrency',
        'env',
        'name',
        'run-name',
        'jobs',
      ].includes(name)
    )
      continue;
    // Check next non-empty line is indented >= 4 spaces
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && lines[j].match(/^    /)) {
      jobRanges.push({ name, startLine: i });
    }
  }

  // For each job, find its end: next top-level "  <key>:" line at 2-indent
  for (let idx = 0; idx < jobRanges.length; idx++) {
    const { name, startLine } = jobRanges[idx];
    const endLine =
      idx + 1 < jobRanges.length ? jobRanges[idx + 1].startLine : lines.length;

    // Parse steps: lines starting with "      - " (6 spaces + dash)
    const steps = [];
    const stepStartIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (i >= startLine && i < endLine && /^      - /.test(lines[i])) {
        stepStartIndices.push(i);
      }
    }
    for (let si = 0; si < stepStartIndices.length; si++) {
      const sStart = stepStartIndices[si];
      const sEnd =
        si + 1 < stepStartIndices.length ? stepStartIndices[si + 1] : endLine;
      const stepBlock = lines.slice(sStart, sEnd).join('\n');
      steps.push({
        uses: stepBlock.match(/uses:\s*(\S+)/)?.[1] || null,
        name: stepBlock.match(/name:\s*(.+)/)?.[1]?.trim() || null,
      });
    }
    jobs[name] = { name, steps };
  }
  return jobs;
}

/**
 * Check whether a step is an action checkout step.
 */
function isCheckoutStep(step) {
  return Boolean(step.uses && step.uses.startsWith('actions/checkout@'));
}

/**
 * Check whether a step runs a local action from .github/actions/.
 */
function isLocalActionStep(step) {
  return Boolean(step.uses && step.uses.startsWith('./.github/actions/'));
}

test('every local action step has a preceding checkout step in the same job', () => {
  const ymlFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') && !f.startsWith('_'));

  const violations = [];

  for (const file of ymlFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const jobs = parseWorkflowJobs(content);

    for (const [, job] of Object.entries(jobs)) {
      let hasCheckout = false;
      for (const step of job.steps) {
        if (isCheckoutStep(step)) {
          hasCheckout = true;
        }
        if (isLocalActionStep(step) && !hasCheckout) {
          const stepLabel = step.name ? `"${step.name}"` : step.uses;
          violations.push({
            file,
            job: job.name,
            step: stepLabel,
          });
        }
      }
    }
  }

  // Build a readable assertion message if violations found
  if (violations.length > 0) {
    const lines = violations
      .map((v) => `  ${v.file} → job "${v.job}" → step ${v.step}`)
      .join('\n');
    assert.fail(
      `${violations.length} job(s) use local actions without a preceding checkout:\n${lines}`,
    );
  }
});
