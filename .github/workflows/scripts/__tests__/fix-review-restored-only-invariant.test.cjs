/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariants for fix-review.yml's restore-protected-path
// handling. The workflow force-restores .github/actions/ after the agent
// runs, so a fix confined to that path can never reach the PR branch. That
// state must be reported as "manual commit needed" — not as a clean no-op —
// and must NOT retrigger code-review as false-positives-confirmed (which
// previously re-greenlit a PR whose real finding was silently reverted).
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
    /git status --porcelain -- \.github\/actions/,
    'detect-noop must probe the force-restored path separately',
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

test('finished summary forwards restored_only to the sticky comment', () => {
  assert.match(
    content,
    /RESTORED_ONLY: \$\{\{ steps\.detect-noop\.outputs\.restored_only \}\}/,
  );
  assert.match(content, /--restored-only "\$RESTORED_ONLY"/);
});
