/* eslint-disable @typescript-eslint/no-require-imports */
// Guard for closing a source PR during stale-PR consolidation. Closing is the
// one destructive, hard-to-reverse step in the workflow, so every precondition
// from the merge-pr plan must hold before a source PR is closed. Pure function:
// callers pass the resolved booleans; this module only decides and explains.
//
// A source PR is closed only after the replacement PR is pushed, opened,
// validated, green (finalizer-eligible or intentionally manual-only), linked to
// every source, carries the review-debt summary, the source is unchanged since
// collection, the run is not a dry run, and the new labels/branch prefix are
// registered in policy. Any single miss => leave the source PR open.

const CONDITIONS = [
  ['replacementPushed', 'replacement branch was pushed'],
  ['replacementPrOpened', 'replacement PR was opened'],
  ['validationPassed', 'replacement branch validation passed'],
  [
    'replacementGreen',
    'replacement PR reached pr-flow/ready or intentional flow/manual-only',
  ],
  ['bodyLinksAllSources', 'replacement PR body links every source PR'],
  [
    'bodyListsFindings',
    'replacement PR body lists review findings addressed and skipped',
  ],
  [
    'sourceUnchangedSinceCollection',
    'source PR received no newer human commit after collection',
  ],
  ['notDryRun', 'run is not a dry run'],
  ['labelsPolicyOk', 'new labels and branch prefix are registered in policy'],
];

function isTrue(value) {
  return value === true || value === 'true';
}

// Returns { canClose, reasons }. `conditions` may use boolean or "true"/"false"
// strings (GitHub step outputs arrive as strings). When `dryRun` is present it
// derives `notDryRun` (and takes precedence), so the workflow can pass its
// dry-run flag directly instead of pre-inverting it.
function canCloseSourcePr(conditions = {}) {
  const normalized = { ...conditions };
  if ('dryRun' in normalized) {
    normalized.notDryRun = !isTrue(normalized.dryRun);
  }
  const reasons = CONDITIONS.filter(([key]) => !isTrue(normalized[key])).map(
    ([, label]) => label,
  );
  return { canClose: reasons.length === 0, reasons };
}

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  const json = getArg('--json') || process.env.MERGE_PR_CLOSE_CONDITIONS_JSON;
  if (!json) {
    throw new Error(
      '--json (conditions object) or MERGE_PR_CLOSE_CONDITIONS_JSON is required.',
    );
  }
  const decision = canCloseSourcePr(JSON.parse(json));
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const fs = require('node:fs');
    fs.appendFileSync(
      githubOutput,
      `can_close=${decision.canClose}\nclose_reasons=${JSON.stringify(decision.reasons)}\n`,
    );
  }
  console.log(
    `${decision.canClose ? 'CAN_CLOSE' : 'KEEP_OPEN'}: ${decision.reasons.join('; ') || 'all conditions met'}`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { CONDITIONS, isTrue, canCloseSourcePr };
