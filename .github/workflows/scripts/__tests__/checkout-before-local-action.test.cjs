/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every job step that uses a local action
// (`uses: ./.github/actions/*`) must be preceded by an `actions/checkout@`
// step in the same job that runs whenever the local action runs. A local
// action cannot be resolved before the repository exists in the workspace,
// and because dependent jobs guard on gate outputs without `always()`, an
// unresolved gate silently skips the whole workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

// `if:` guards that always hold, so a checkout carrying one is effectively
// unconditional. Any other guard makes the checkout conditional.
const ALWAYS_TRUE_CONDITIONS = new Set(['always()', 'true']);

/**
 * Normalize an `if:` expression so semantically identical guards compare
 * equal: strip ${{ }} interpolation wrappers and collapse whitespace.
 */
function normalizeIf(condition) {
  return condition
    .replace(/\$\{\{|\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAlwaysTrue(condition) {
  return (
    condition === null || ALWAYS_TRUE_CONDITIONS.has(normalizeIf(condition))
  );
}

/**
 * Extract a step-level key's value from the step's lines.
 *
 * Step keys sit either inline right after the leading "- " or at the
 * 8-space step-key indent. Deeper-indented lines are `with:`/`env:`/`run:`
 * bodies — matching keys there (a `name:` argument inside `with:`, or the
 * text "uses:" inside a run script) would misclassify the step.
 */
function stepKeyValue(stepLines, key) {
  for (let i = 0; i < stepLines.length; i++) {
    const m = stepLines[i].match(
      /^(?:      - |        )([A-Za-z][\w-]*):(?:\s+(.*))?$/,
    );
    if (!m || m[1] !== key) continue;
    let value = (m[2] ?? '').trim();
    if (/^[|>][+-]?\d*$/.test(value)) {
      // Folded/literal block: the value lives on the following,
      // deeper-indented lines until the next step key.
      const body = [];
      for (let j = i + 1; j < stepLines.length; j++) {
        if (/^(?:      - |        )\S/.test(stepLines[j])) break;
        body.push(stepLines[j].trim());
      }
      value = body.join(' ');
    }
    return value;
  }
  return null;
}

/**
 * Parse a workflow YAML into per-job step arrays.
 * Uses regex scanning (no YAML dependency) consistent with other e2e tests.
 *
 * Returns { jobName: { name, steps: [{ uses, name, if }] } }
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
      const stepLines = lines.slice(sStart, sEnd);
      steps.push({
        uses: stepKeyValue(stepLines, 'uses'),
        name: stepKeyValue(stepLines, 'name'),
        if: stepKeyValue(stepLines, 'if'),
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
    // Underscore-prefixed reusable workflows and `.yaml` spellings belong
    // to the invariant surface too — excluding them would leave the files
    // with the most local-action steps (e.g. _auto-fix-ci.yml) uncovered.
    .filter((f) => /\.(yml|yaml)$/.test(f));

  const violations = [];
  let inspectedLocalActionSteps = 0;

  for (const file of ymlFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const jobs = parseWorkflowJobs(content);

    for (const [, job] of Object.entries(jobs)) {
      let hasUnconditionalCheckout = false;
      let sawCheckout = false;
      const conditionalCheckoutGuards = new Set();

      for (const step of job.steps) {
        if (isCheckoutStep(step)) {
          sawCheckout = true;
          if (isAlwaysTrue(step.if)) {
            hasUnconditionalCheckout = true;
          } else {
            conditionalCheckoutGuards.add(normalizeIf(step.if));
          }
        }
        if (!isLocalActionStep(step)) continue;

        inspectedLocalActionSteps += 1;

        // A conditional checkout only covers local actions guarded by the
        // same condition: those steps are skipped exactly when the
        // checkout is skipped, so the action can never resolve against a
        // repository the checkout did not create.
        const actionGuard = step.if === null ? null : normalizeIf(step.if);
        const covered =
          hasUnconditionalCheckout ||
          (actionGuard !== null && conditionalCheckoutGuards.has(actionGuard));
        if (covered) continue;

        const stepLabel = step.name ? `"${step.name}"` : step.uses;
        const reason = sawCheckout
          ? "preceding checkout is conditional and does not share this step's if: guard"
          : 'no preceding actions/checkout@ step';
        violations.push({ file, job: job.name, step: stepLabel, reason });
      }
    }
  }

  // Guard against vacuous passes: a scanner break (renamed extension,
  // changed step indentation, empty directory listing) would otherwise
  // leave this test green with zero actual coverage.
  assert.ok(ymlFiles.length > 0, 'no workflow files found to inspect');
  assert.ok(
    inspectedLocalActionSteps > 0,
    'scanner inspected zero local action steps — invariant ran vacuously',
  );

  // Build a readable assertion message if violations found
  if (violations.length > 0) {
    const lines = violations
      .map((v) => `  ${v.file} → job "${v.job}" → step ${v.step} (${v.reason})`)
      .join('\n');
    assert.fail(
      `${violations.length} job(s) use local actions without a preceding checkout:\n${lines}`,
    );
  }
});
