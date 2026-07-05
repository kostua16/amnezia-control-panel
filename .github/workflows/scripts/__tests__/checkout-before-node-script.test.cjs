/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every job step that runs `node .github/workflows/scripts/`
// must have a preceding `actions/checkout@` step in the same job.
// Catches the latent bug from PR #596 where fix-review.yml ran a local script
// without checking out the repo first.
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
 * Returns { jobName: { name, steps: [{ uses?, run?, name? }] } }
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
      ['on', 'permissions', 'concurrency', 'env', 'name', 'run-name', 'jobs'].includes(name)
    ) continue;
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
    const endLine = idx + 1 < jobRanges.length ? jobRanges[idx + 1].startLine : lines.length;

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
      const sEnd = si + 1 < stepStartIndices.length ? stepStartIndices[si + 1] : endLine;
      const stepBlock = lines.slice(sStart, sEnd).join('\n');
      const usesMatch = stepBlock.match(/uses:\s*(\S+)/);
      // run: can be a block scalar ("run: |" or "run: >") spanning multiple
      // lines, or an inline single-line command. Check block scalars FIRST —
      // the inline regex below would otherwise capture "|" / ">" as the literal
      // run content and silently skip the dominant multiline form.
      let runContent = null;
      if (/^        run:\s*[|>]/m.test(stepBlock)) {
        // Multiline block scalar: collect lines indented 10+ spaces under the indicator
        const runLines = [];
        let inRun = false;
        for (const line of stepBlock.split('\n')) {
          if (/^        run:\s*[|>]/.test(line)) { inRun = true; continue; }
          if (inRun) {
            if (/^        \S/.test(line) && !/^          /.test(line)) break;
            if (line.trim() === '') { runLines.push(''); continue; }
            runLines.push(line.replace(/^          /, ''));
          }
        }
        if (runLines.length) runContent = runLines.join('\n');
      } else {
        const runInline = stepBlock.match(/^        run:\s*(.+)$/m);
        if (runInline) {
          runContent = runInline[1];
        }
      }
      steps.push({
        uses: usesMatch ? usesMatch[1] : null,
        run: runContent,
        name: stepBlock.match(/name:\s*(.+)/)?.[1]?.trim() || null,
      });
    }
    jobs[name] = { name, steps };
  }
  return jobs;
}

/**
 * Check whether a step's run block (or inline run) invokes a local node script
 * from .github/workflows/scripts/.
 */
function isLocalNodeScriptStep(step) {
  if (!step.run) return false;
  // Match any `node .github/workflows/scripts/` or `node .github/...` invocation
  return /node\s+\.github\/workflows\/scripts\//.test(step.run);
}

/**
 * Check whether a step is an actions/checkout action.
 */
function isCheckoutStep(step) {
  return step.uses && step.uses.startsWith('actions/checkout@');
}

test('every local node script step has a preceding checkout step in the same job', () => {
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
        if (isLocalNodeScriptStep(step) && !hasCheckout) {
          const stepLabel = step.name
            ? `"${step.name}"`
            : step.run?.split('\n')[0]?.trim()?.slice(0, 60) || 'unnamed';
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
      `${violations.length} job(s) run local node scripts without a preceding checkout:\n${lines}`,
    );
  }
});

test('fix-review.yml fix job has two checkout steps (default + PR head)', () => {
  const content = fs.readFileSync(
    path.join(workflowsDir, 'fix-review.yml'),
    'utf8',
  );
  const jobs = parseWorkflowJobs(content);
  const fixJob = jobs['fix'];
  assert.ok(fixJob, 'fix job should exist');

  const checkouts = fixJob.steps.filter(isCheckoutStep);
  assert.equal(
    checkouts.length,
    2,
    'fix job should have two checkout steps (default branch + PR head)',
  );
});
