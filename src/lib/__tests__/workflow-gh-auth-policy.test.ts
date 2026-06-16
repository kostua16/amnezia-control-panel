import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('workflow gh auth policy', () => {
  it('lets setup-environment callers opt out of hard gh auth failures', () => {
    const action = readRepoFile('.github/actions/setup-environment/action.yml');

    assert.match(action, /require-gh-auth:/);
    assert.match(
      action,
      /continue-on-error: \$\{\{ inputs\.require-gh-auth != 'true' \}\}/,
    );
    assert.match(action, /if: inputs\.require-gh-auth == 'true'/);
  });

  it('keeps CI jobs independent from gh auth', () => {
    const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
    const optOuts = ciWorkflow.match(/require-gh-auth: 'false'/g) ?? [];

    assert.equal(optOuts.length, 5);
  });

  it('treats performance check comments as best-effort', () => {
    const perfWorkflow = readRepoFile('.github/workflows/perf-check.yml');

    assert.match(perfWorkflow, /require-gh-auth: 'false'/);
    assert.match(
      perfWorkflow,
      /Failed to post Performance Check comment after 3 attempts; keeping metrics job green\./,
    );
    assert.match(
      perfWorkflow,
      /if gh pr comment "\$PR_NUMBER" --body "\$body"; then/,
    );
    assert.doesNotMatch(
      perfWorkflow,
      /gh pr comment "\$PR_NUMBER" --body "\$BODY"\n/,
    );
  });
});
