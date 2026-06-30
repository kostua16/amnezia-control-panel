/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');

const CHECKS = [
  { key: 'lint', label: 'lint (tracked files)' },
  { key: 'typecheck', label: 'typecheck' },
  { key: 'format', label: 'format (prettier)' },
  { key: 'test', label: 'unit tests' },
  { key: 'build', label: 'build', skippedPasses: true },
  { key: 'scriptTests', label: 'workflow script e2e-tests' },
  { key: 'prismaSafe', label: 'prisma-safe-sql' },
];

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function normalizeOutcome(outcome) {
  return String(outcome ?? '')
    .trim()
    .toLowerCase();
}

function isPassingOutcome(key, outcome) {
  const normalized = normalizeOutcome(outcome);
  if (normalized === 'success') return true;
  return key === 'build' && normalized === 'skipped';
}

function isKnownOutcome(outcome) {
  return normalizeOutcome(outcome) !== '';
}

function rowFor(check, baseline, post) {
  return {
    key: check.key,
    label: check.label,
    baseline: normalizeOutcome(baseline[check.key]),
    post: normalizeOutcome(post[check.key]),
  };
}

function compareGateOutcomes({ baseline = {}, post = {} } = {}) {
  const rows = CHECKS.map((check) => rowFor(check, baseline, post));
  const baselineUnavailable = rows.some((row) => !isKnownOutcome(row.baseline));
  const postAllPassing = rows.every((row) =>
    isPassingOutcome(row.key, row.post),
  );
  const postMissing = rows.some((row) => !isKnownOutcome(row.post));

  const newFailures = [];
  const preExistingFailures = [];
  const improvedFailures = [];

  if (!baselineUnavailable) {
    rows.forEach((row) => {
      const baselinePassed = isPassingOutcome(row.key, row.baseline);
      const postPassed = isPassingOutcome(row.key, row.post);
      if (baselinePassed && !postPassed) {
        newFailures.push(row);
      } else if (!baselinePassed && !postPassed) {
        // Red in both baseline and post: classified as pre-existing, which
        // grants no-worse push permission. The gate exposes only per-check
        // outcomes (success/failure/skipped), so a new failure hidden within
        // an already-red check cannot be distinguished here. renderGateComparison
        // surfaces this caveat in the sticky comment so a reviewer can verify
        // the rebase did not worsen the pre-existing failure.
        preExistingFailures.push(row);
      } else if (!baselinePassed && postPassed) {
        improvedFailures.push(row);
      }
    });
  }

  const noNewFailures =
    postAllPassing ||
    (!baselineUnavailable && !postMissing && newFailures.length === 0);

  return {
    no_new_failures: noNewFailures,
    baseline_unavailable: baselineUnavailable,
    post_all_passing: postAllPassing,
    new_failures: newFailures,
    pre_existing_failures: preExistingFailures,
    improved_failures: improvedFailures,
    rows,
  };
}

function outcomeLabel(outcome) {
  if (outcome === 'success') return 'pass';
  if (outcome === 'failure') return 'fail';
  return outcome || 'unknown';
}

function renderRows(title, rows) {
  if (rows.length === 0) return [];
  return [
    `${title}:`,
    ...rows.map(
      (row) =>
        `- ${row.label}: before **${outcomeLabel(row.baseline)}**, after **${outcomeLabel(row.post)}**`,
    ),
  ];
}

function renderComparisonSummary(comparison) {
  const lines = [
    comparison.no_new_failures
      ? 'CI comparison: no new failures after rebase.'
      : 'CI comparison: rebase introduced new failures or baseline was unavailable.',
  ];

  if (comparison.baseline_unavailable) {
    lines.push(
      '- Baseline gate was unavailable, so no-worse push permission is not granted unless the post-rebase gate is fully green.',
    );
  }

  lines.push(
    ...renderRows('New failures', comparison.new_failures),
    ...renderRows('Pre-existing failures', comparison.pre_existing_failures),
    ...renderRows('Improved failures', comparison.improved_failures),
  );

  return lines.join('\n');
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const text = String(value);
  if (!outputPath) {
    console.log(`${name}=${text}`);
    return;
  }
  if (!text.includes('\n')) {
    fs.appendFileSync(outputPath, `${name}=${text}\n`, 'utf8');
    return;
  }
  fs.appendFileSync(
    outputPath,
    `${name}<<REBASE_GATE_${name}_EOF\n${text}\nREBASE_GATE_${name}_EOF\n`,
    'utf8',
  );
}

function main() {
  const baseline = {
    lint: getArg('--baseline-lint'),
    typecheck: getArg('--baseline-typecheck'),
    format: getArg('--baseline-format'),
    test: getArg('--baseline-test'),
    build: getArg('--baseline-build'),
    scriptTests: getArg('--baseline-script-tests'),
    prismaSafe: getArg('--baseline-prisma-safe'),
  };
  const post = {
    lint: getArg('--post-lint'),
    typecheck: getArg('--post-typecheck'),
    format: getArg('--post-format'),
    test: getArg('--post-test'),
    build: getArg('--post-build'),
    scriptTests: getArg('--post-script-tests'),
    prismaSafe: getArg('--post-prisma-safe'),
  };
  const comparison = compareGateOutcomes({ baseline, post });
  writeOutput('no_new_failures', comparison.no_new_failures ? 'true' : 'false');
  writeOutput(
    'baseline_unavailable',
    comparison.baseline_unavailable ? 'true' : 'false',
  );
  writeOutput('new_failures', JSON.stringify(comparison.new_failures));
  writeOutput(
    'pre_existing_failures',
    JSON.stringify(comparison.pre_existing_failures),
  );
  writeOutput(
    'improved_failures',
    JSON.stringify(comparison.improved_failures),
  );
  writeOutput('comparison_json', JSON.stringify(comparison));
  writeOutput('summary', renderComparisonSummary(comparison));
}

if (require.main === module) {
  main();
}

module.exports = {
  CHECKS,
  compareGateOutcomes,
  isPassingOutcome,
  normalizeOutcome,
  outcomeLabel,
  renderComparisonSummary,
};
