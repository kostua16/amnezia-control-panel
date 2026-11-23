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
    const setupEnvUses =
      ciWorkflow.match(/uses: \.\/\.github\/actions\/setup-environment/g) ?? [];

    // CI must stay runnable without gh credentials (fork/PR builds), so EVERY
    // setup-environment call must opt out of hard gh-auth failure. Comparing
    // opt-outs to setup-environment uses is resilient to adding jobs (both
    // counts grow together) without being vacuous: a job that drops the opt-out
    // makes optOuts < setupEnvUses and fails the test.
    assert.equal(
      optOuts.length,
      setupEnvUses.length,
      'every CI setup-environment call must set require-gh-auth: false',
    );
  });

  it('offers an env auth mode that skips setup-gh token validation', () => {
    const action = readRepoFile('.github/actions/setup-environment/action.yml');

    // validate stays the default, so callers that do not opt in keep the
    // setup-gh login + `gh auth status` path unchanged.
    assert.match(
      action,
      /gh-auth-mode:\r?\n\s+description: .*\r?\n\s+default: 'validate'/,
    );
    assert.match(
      action,
      /id: setup_gh\r?\n\s+if: inputs\.gh-auth-mode != 'env'/,
    );
    assert.match(
      action,
      /if: inputs\.require-gh-auth == 'true' && inputs\.gh-auth-mode != 'env'/,
    );
    assert.match(action, /if: inputs\.gh-auth-mode == 'env'/);
    assert.match(action, /echo "::add-mask::\$GH_AUTH_TOKEN"/);
    assert.match(action, /echo "GH_TOKEN=\$GH_AUTH_TOKEN" >> "\$GITHUB_ENV"/);
    // The strict/soft split mirrors require-gh-auth: strict callers fail on a
    // missing gh, an empty token or a zero quota; CI and perf-check only warn.
    assert.match(action, /if \[\[ "\$REQUIRE_GH_AUTH" == 'true' \]\]; then/);
    assert.match(
      action,
      /"\$REQUIRE_GH_AUTH" == 'true' && "\$CORE_REMAINING" == '0'/,
    );
    assert.match(
      action,
      /CORE_REMAINING: \$\{\{ steps\.rate_limit\.outputs\.core-remaining \}\}/,
    );
  });

  it('keeps CI soft on gh auth after opting into env mode', () => {
    const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
    const setupEnvUses =
      ciWorkflow.match(/uses: \.\/\.github\/actions\/setup-environment/g) ?? [];
    const envMode =
      ciWorkflow.match(
        /gh-auth-mode: \$\{\{ vars\.GH_AUTH_MODE \|\| 'env' \}\}/g,
      ) ?? [];

    assert.equal(envMode.length, setupEnvUses.length);
    assert.doesNotMatch(ciWorkflow, /require-gh-auth: 'true'/);
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
