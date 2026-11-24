/* eslint-disable @typescript-eslint/no-require-imports */
// Pins the REST-budget cuts in the Code Review chain (Code Review is the most
// quota-expensive PR-flow workflow; every call here is shared installation
// quota). Each cut must keep the observable end state identical:
// - Apply review signals reads the PR's current labels fresh via GraphQL
//   (metered against the token's separate GraphQL points budget — the
//   `graphql` resource of /rate_limit — not the REST `core` request budget
//   the label writes spend) and writes only real label deltas — no
//   guaranteed-404 removeLabel, no no-op addLabels, no label events that did
//   not fire before. Reading fresh (not from a resolve-pr snapshot) keeps the
//   gate correct when labels change mid-run or a job re-run reuses stored
//   outputs; any read failure, truncated label page, or unexpected shape
//   fails open to the historical unconditional writes.
// - The claude-health tracker syncs its critical label only when the label
//   presence actually differs from the run's needs (listForRepo already
//   returned the current labels).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const codeReviewYml = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/code-review.yml'),
  'utf8',
);
const runClaudeParamsYml = fs.readFileSync(
  path.join(repoRoot, '.github/actions/run-claude-params/action.yml'),
  'utf8',
);

function applySignalsStep() {
  const step = codeReviewYml.match(
    /- name: Apply review signals[\s\S]*?(?=\n {6}- name: Post review summary)/,
  );
  assert.ok(step, 'Apply review signals step not found');
  return step[0];
}

test('Apply review signals reads current labels fresh via GraphQL, not a snapshot', () => {
  const script = applySignalsStep();

  // Fresh read at apply time through GraphQL (metered against the separate
  // GraphQL points budget, not the REST core budget the writes spend)…
  assert.match(script, /await github\.graphql\(/);
  assert.match(
    script,
    /labels\(first: 100\) \{\s*pageInfo \{ hasNextPage \}\s*nodes \{ name \}/,
  );
  // …and NOT a reused resolve-pr snapshot output (which could be stale on a
  // re-run or after a mid-run label change).
  assert.doesNotMatch(script, /PR_LABELS/);
  assert.doesNotMatch(
    codeReviewYml,
    /pr-labels: \$\{\{ steps\.resolve\.outputs\.pr_labels \}\}/,
    'resolve-pr must not publish a label snapshot the signal step reuses',
  );
  // The read must not add a REST-core call either.
  assert.doesNotMatch(script, /rest\.issues\.listLabelsOnIssue/);
});

test('Apply review signals fails open and validates the label shape', () => {
  const script = applySignalsStep();

  // A weak Array.isArray check would let [null] through and silently invert the
  // gate; every node must carry a string name or the read is rejected.
  assert.match(
    script,
    /Array\.isArray\(nodes\) &&\s*nodes\.every\(\(n\) => n && typeof n\.name === 'string'\)/,
  );
  // A truncated page could hide a review label, so it must fail open too.
  assert.match(script, /labels\?\.pageInfo\?\.hasNextPage !== true &&/);
  // Any read error or unexpected shape leaves currentLabels null and restores
  // the historical unconditional writes rather than skipping label signals.
  assert.match(script, /let currentLabels = null;/);
  assert.match(script, /currentLabels === null\s*\?\s*labelsToRemove/);
  assert.match(script, /currentLabels === null\s*\?\s*labelsToAdd/);
  // The warning must survive a non-Error throw.
  assert.match(script, /error\?\.message \|\| String\(error\)/);
  assert.match(script, /catch \(error\) \{\s*core\.warning\(/);
});

test('Apply review signals writes only real label deltas', () => {
  const script = applySignalsStep();

  // Only remove labels the fresh read shows present, and only add labels it
  // shows missing; the addLabels call is skipped entirely when nothing changes.
  assert.match(
    script,
    /labelsToRemove\.filter\(\(name\) => currentLabels\.includes\(name\)\)/,
  );
  assert.match(
    script,
    /labelsToAdd\.filter\(\(name\) => !currentLabels\.includes\(name\)\)/,
  );
  assert.match(script, /if \(additions\.length > 0\)/);
  // A removeLabel that still 404s (raced) is tolerated, not fatal.
  assert.match(script, /if \(error\.status !== 404\) throw error;/);
});

test('claude-health critical label is synced only when its presence changes', () => {
  assert.match(
    runClaudeParamsYml,
    /trackerHasCritical = \(tracker\.labels \|\| \[\]\)\.some\(/,
    'tracker lookup must capture the current critical-label presence',
  );
  // Clean runs must not pay a no-op removeLabel…
  assert.match(
    runClaudeParamsYml,
    /if \(issueNumber && trackerHasCritical\) \{\s*\n\s*await syncCriticalLabel\(issueNumber, false\);/,
  );
  // …and finding runs only write when the desired presence differs.
  assert.match(
    runClaudeParamsYml,
    /if \(hasError !== trackerHasCritical\) \{\s*\n\s*await syncCriticalLabel\(issueNumber, hasError\);/,
  );
});

test('wake chain and review-label contract stay intact', () => {
  // The cuts must not touch the orchestrator wake dispatches…
  assert.match(codeReviewYml, /gh workflow run pr-flow\.yml/);
  assert.match(codeReviewYml, /gh workflow run auto-cover-review\.yml/);
  // …or the four review labels this workflow owns.
  assert.match(
    codeReviewYml,
    /names: ai-review-passed,ai-review-concerns,security-review-passed,security-review-concerns/,
  );
});
