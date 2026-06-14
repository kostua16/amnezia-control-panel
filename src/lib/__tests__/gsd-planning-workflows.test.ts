import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(process.cwd(), repoPath), 'utf8');
}

describe('GSD planning workflow automation', () => {
  it('runs the planning executor four times per day and caps scheduled imports to one plan', () => {
    const workflow = readRepoFile('.github/workflows/gsd-planning-execute.yml');

    assert.match(workflow, /cron: '0 \*\/6 \* \* \*'/);
    assert.match(workflow, /group: gsd-planning-execute-main/);
    assert.match(workflow, /max_plans=1/);
    assert.match(
      workflow,
      /collect-gsd-planning-intake\.cjs[\s\S]*--max-plans "\$max_plans"/,
    );
    assert.match(workflow, /\/gsd:execute-phase 999 --wave/);
    assert.match(workflow, /labels: auto-fix,gsd-plan-execution,skip-improve/);
    assert.match(workflow, /draft: 'false'/);
    assert.match(workflow, /<!-- gsd-planning-source-sha256:/);
  });

  it('creates planning intake PRs as non-drafts with the intake label', () => {
    for (const workflowPath of [
      '.github/workflows/gsd-planning.yml',
      '.github/workflows/suggest-improvements.yml',
    ]) {
      const workflow = readRepoFile(workflowPath);

      assert.match(workflow, /labels: planning-intake-open/, workflowPath);
      assert.match(workflow, /draft: 'false'/, workflowPath);
      assert.doesNotMatch(
        workflow,
        /labels: planning-draft-open,needs-review/,
        workflowPath,
      );
      assert.doesNotMatch(workflow, /draft: 'true'/, workflowPath);
    }
  });

  it('keeps PR Improve planning PRs ready for auto-merge instead of draft-only', () => {
    const script = readRepoFile(
      '.github/workflows/scripts/upsert-planning-pr.cjs',
    );
    const workflow = readRepoFile('.github/workflows/pr-improve.yml');

    assert.match(script, /planning-intake-open/);
    assert.doesNotMatch(script, /'--draft'/);
    assert.match(
      workflow,
      /names: skip-improve,planning-intake-open,planning-draft-open/,
    );
    assert.match(workflow, /labels: \['planning-intake-open'\]/);
  });

  it('pushes branches that are already ahead after GSD creates commits', () => {
    const action = readRepoFile('.github/actions/commit-and-push/action.yml');

    assert.match(action, /commit_created=false/);
    assert.match(action, /origin\/HEAD\.\.HEAD/);
    assert.match(action, /Branch is not ahead of origin\/\$BRANCH/);
  });

  it('validates and repairs GSD executions before pushing a PR branch', () => {
    const workflow = readRepoFile('.github/workflows/gsd-planning-execute.yml');
    const validateIndex = workflow.indexOf('name: Validate execution output');
    const commitIndex = workflow.indexOf('./.github/actions/commit-and-push');

    assert.ok(validateIndex > 0, 'validation step must exist');
    assert.ok(commitIndex > validateIndex, 'validation must run before commit');
    assert.match(
      workflow,
      /uses: \.\/\.github\/actions\/run-npm-test-validation/,
    );
    assert.doesNotMatch(
      workflow,
      /npm test > "\$RUNNER_TEMP\/gsd-planning-validation-/,
    );
    assert.match(
      workflow,
      /name: Repair validation failures[\s\S]*uses: \.\/\.github\/actions\/run-gsd-validation-repair/,
    );
    assert.match(
      workflow,
      /name: Repair remaining validation failures[\s\S]*uses: \.\/\.github\/actions\/run-gsd-validation-repair/,
    );
    assert.match(workflow, /final-pass: 'true'/);
    assert.match(
      workflow,
      /did not reach a passing npm test after two repair passes/,
    );
    assert.match(workflow, /id: final-zai/);
    assert.match(workflow, /if \[ "\$REPAIR2_OUTCOME" = "success" \]/);
    assert.match(workflow, /elif \[ "\$REPAIR1_OUTCOME" = "success" \]/);
    assert.doesNotMatch(
      workflow,
      /steps\.repair[12]\.outcome == 'success' && steps\.repair[12]\.outputs/,
    );
    assert.match(
      workflow,
      /changed-files: \$\{\{ steps\.final-zai\.outputs\.changed_files \}\}/,
    );
  });

  it('creates follow-up issues for deferred GSD planning proposals', () => {
    const workflow = readRepoFile('.github/workflows/gsd-planning-execute.yml');
    const policy = readRepoFile('.github/workflows/policy.json');
    const finalZaiIndex = workflow.indexOf('id: final-zai');
    const detectIndex = workflow.indexOf('id: detect_deferred_proposals');
    const createIndex = workflow.indexOf(
      'name: Create issues for deferred GSD proposals',
    );
    const prBodyIndex = workflow.indexOf('name: Build execution PR body');

    assert.match(workflow, /issues: write/);
    assert.ok(finalZaiIndex > 0, 'final output selection must exist');
    assert.ok(
      detectIndex > finalZaiIndex,
      'deferred proposal detection must run after final output selection',
    );
    assert.ok(
      createIndex > detectIndex,
      'deferred proposal issue creation must run after detection',
    );
    assert.ok(
      prBodyIndex > createIndex,
      'deferred proposal issues must be created before the execution PR body',
    );
    assert.match(
      workflow,
      /name: Create issues for deferred GSD proposals[\s\S]*continue-on-error: true/,
    );
    assert.match(workflow, /### Proposals deferred/);
    assert.match(workflow, /--mode gsd-deferred-proposals --report-only/);
    assert.match(
      workflow,
      /node \.github\/workflows\/scripts\/upsert-audit-manual-findings\.cjs --mode gsd-deferred-proposals/,
    );
    assert.match(
      workflow,
      /CLAUDE_STRUCTURED_OUTPUT: \$\{\{ steps\.final-zai\.outputs\.structured_output \}\}/,
    );
    assert.match(
      workflow,
      /CLAUDE_LAST_OUTPUT: \$\{\{ steps\.final-zai\.outputs\.last_output \}\}/,
    );
    assert.match(
      workflow,
      /CHANGED_FILES: \$\{\{ steps\.final-zai\.outputs\.changed_files \}\}/,
    );
    assert.match(
      workflow,
      /names: needs-review,gsd-deferred-proposal,area\/planning/,
    );
    assert.match(policy, /"gsd-deferred-proposal"/);
  });

  it('labels trusted planning and risky GSD execution consistently in PR Policy', () => {
    const workflow = readRepoFile('.github/workflows/pr-policy.yml');

    assert.match(workflow, /policy\.trustedPlanning\?\.branchPrefixes/);
    assert.match(workflow, /trustedPlanning/);
    assert.match(workflow, /gsdExecutionSafe/);
    assert.match(workflow, /isGsdExecution && !gsdExecutionSafe/);
  });
});
