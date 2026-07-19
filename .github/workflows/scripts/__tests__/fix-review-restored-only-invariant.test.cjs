/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariants for fix-review.yml's restore-protected-path
// handling. The workflow force-restores protected paths after the agent
// runs, so a fix confined to them can never reach the PR branch. That
// state must be reported as "manual commit needed" — not as a clean no-op —
// and must NOT retrigger code-review as false-positives-confirmed (which
// previously re-greenlit a PR whose real finding was silently reverted).
//
// The maintainer can opt in (allow-protected-edits label or
// `/fix-review --allow`) to shrink the protected set to only the two
// composite actions the workflow executes with credentials after the agent:
// validate-pr-gate and commit-and-push. Those must stay force-restored in
// EVERY mode — an agent-edited definition there could subvert the gate or
// the push.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github/workflows/fix-review.yml');
const content = fs.readFileSync(workflowPath, 'utf8');

test('detect-noop emits a restored_only output alongside has_changes', () => {
  assert.match(content, /restored_only=true/);
  assert.match(content, /restored_only=false/);
  assert.match(
    content,
    /git status --porcelain -- "\$\{protected_paths\[@\]\}"/,
    'detect-noop must probe the force-restored set separately',
  );
});

test('detect-noop protected set depends on the maintainer opt-in', () => {
  const step = content.slice(
    content.indexOf('Detect no-op'),
    content.indexOf('Restore composite action files'),
  );
  assert.match(
    step,
    /ALLOW_PROTECTED:\s*\$\{\{ steps\.pr\.outputs\.allow_protected_edits \}\}/,
  );
  assert.match(
    step,
    /:\(exclude\)\.github\/actions\/validate-pr-gate/,
    'opt-in mode must still exclude the gate action from pushable changes',
  );
  assert.match(
    step,
    /:\(exclude\)\.github\/actions\/commit-and-push/,
    'opt-in mode must still exclude the push action from pushable changes',
  );
  assert.match(
    step,
    /:\(exclude\)\.github\/actions'/,
    'default mode must exclude all of .github/actions',
  );
});

test('restore step always restores the executing gate/push actions', () => {
  const step = content.slice(
    content.indexOf('Restore composite action files'),
    content.indexOf('Ensure gate action exists'),
  );
  const restoreLines = step
    .split('\n')
    .filter((l) => /^\s*git (checkout|clean)/.test(l));
  assert.ok(restoreLines.length >= 4, 'both modes must clean AND checkout');
  for (const line of restoreLines) {
    assert.match(
      line,
      /\.github\/actions\/validate-pr-gate\/ \.github\/actions\/commit-and-push\/|\.github\/actions\//,
      'every restore command must cover the executing actions',
    );
  }
  assert.match(
    step,
    /git clean -fd -- \.github\/actions\/validate-pr-gate\/ \.github\/actions\/commit-and-push\//,
    'opt-in mode must remove untracked files under the executing actions (git add -A would stage them)',
  );
  assert.match(
    step,
    /git clean -fd -- \.github\/actions\/\n/,
    'default mode must remove untracked files under .github/actions',
  );
});

test('code-review retrigger is gated off when the fix was restored-only', () => {
  const retrigger = content.slice(content.indexOf('Retrigger code-review'));
  assert.ok(retrigger.length > 0, 'retrigger step must exist');
  assert.match(
    retrigger,
    /steps\.detect-noop\.outputs\.restored_only != 'true'/,
    'a reverted fix is not a confirmed false positive — must not retrigger',
  );
});

test('finished summary forwards restored_only and allow_protected to the sticky comment', () => {
  assert.match(
    content,
    /RESTORED_ONLY: \$\{\{ steps\.detect-noop\.outputs\.restored_only \}\}/,
  );
  assert.match(content, /--restored-only "\$RESTORED_ONLY"/);
  assert.match(
    content,
    /ALLOW_PROTECTED: \$\{\{ steps\.pr\.outputs\.allow_protected_edits \}\}/,
  );
  assert.match(content, /--allow-protected "\$ALLOW_PROTECTED"/);
});

test('the protected-edits label is ensured so the maintainer can set it from mobile', () => {
  assert.match(content, /names: allow-protected-edits/);
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, '.github/workflows/policy.json'),
      'utf8',
    ),
  );
  assert.equal(policy.protectedEditsLabel, 'allow-protected-edits');
  assert.ok(
    policy.labels['allow-protected-edits'],
    'label must be defined in policy.labels (ensure-workflow-labels throws otherwise)',
  );
});

test('eligibility resolution consumes the trigger allow flag', () => {
  assert.match(content, /--allow-protected-edits "\$ALLOW_PROTECTED_EDITS"/);
  assert.match(
    content,
    /ALLOW_PROTECTED_EDITS: \$\{\{ needs\.authorize\.outputs\.allow-protected-edits \|\| 'false' \}\}/,
  );
});
