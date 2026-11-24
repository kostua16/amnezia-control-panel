/* eslint-disable @typescript-eslint/no-require-imports */
// Pins the REST-budget cuts in the Code Review chain (Code Review is the most
// quota-expensive PR-flow workflow; every call here is shared installation
// quota). Each cut must keep the observable end state identical:
// - resolve-pr republishes the PR's current labels from the pulls.get it
//   already makes, and Apply review signals writes only real label deltas
//   (no guaranteed-404 removeLabel, no no-op addLabels, no label events that
//   did not fire before). A missing or malformed snapshot falls back to the
//   historical unconditional writes.
// - The complete summary upsert reuses the comment id recorded by the started
//   step instead of re-listing the PR's issue comments; an absent or empty id
//   file keeps the marker-scan fallback.
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

test('resolve-pr publishes the label snapshot from its existing pulls.get', () => {
  assert.match(
    codeReviewYml,
    /pr-labels: \$\{\{ steps\.resolve\.outputs\.pr_labels \}\}/,
    'resolve-pr job must expose a pr-labels output',
  );
  assert.match(
    codeReviewYml,
    /core\.setOutput\(\s*'pr_labels',/,
    'the resolve script must emit pr_labels from the pulls.get response',
  );
  // The snapshot must come from the PR object already fetched — a separate
  // labels read would defeat the cut.
  assert.doesNotMatch(
    codeReviewYml,
    /rest\.issues\.listLabelsOnIssue/,
    'label snapshot must not add a separate REST read',
  );
});

test('Apply review signals writes only real label deltas', () => {
  const step = codeReviewYml.match(
    /- name: Apply review signals[\s\S]*?(?=\n {6}- name: Post review summary)/,
  );
  assert.ok(step, 'Apply review signals step not found');
  const script = step[0];

  // Snapshot arrives through the PR_LABELS env bound to the resolve-pr output.
  assert.match(
    script,
    /PR_LABELS: \$\{\{ needs\.resolve-pr\.outputs\.pr-labels \}\}/,
  );

  // Fail-open: an unparsable or missing snapshot restores the unconditional
  // write path rather than silently skipping label signals.
  assert.match(script, /currentLabels === null\s*\?\s*labelsToRemove/);
  assert.match(script, /currentLabels === null\s*\?\s*labelsToAdd/);

  // Only remove labels the snapshot says are present, and only add labels it
  // says are missing; the addLabels call is skipped entirely when nothing
  // would change.
  assert.match(
    script,
    /labelsToRemove\.filter\(\(name\) => currentLabels\.includes\(name\)\)/,
  );
  assert.match(
    script,
    /labelsToAdd\.filter\(\(name\) => !currentLabels\.includes\(name\)\)/,
  );
  assert.match(script, /if \(additions\.length > 0\)/);
});

test('complete summary upsert reuses the id recorded by the started step', () => {
  // The started step records the created comment id on the runner…
  assert.match(
    codeReviewYml,
    /--emit-id-file "\$RUNNER_TEMP\/code-review-summary-comment-id"/,
    'started step must emit the sticky comment id',
  );
  // …and the complete step only passes it when the file exists and is
  // non-empty, so the marker-scan list stays as the fallback.
  assert.match(
    codeReviewYml,
    /if \[\[ -s "\$comment_id_file" \]\]; then/,
    'complete step must guard the known-id reuse with a non-empty file check',
  );
  assert.match(
    codeReviewYml,
    /--known-comment-id "\$\(cat "\$comment_id_file"\)"/,
    'complete step must forward the recorded comment id',
  );
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
