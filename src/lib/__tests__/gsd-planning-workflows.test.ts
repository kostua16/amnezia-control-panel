import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(process.cwd(), repoPath), 'utf8');
}

function listWorkflowFiles() {
  const workflowsDir = path.join(process.cwd(), '.github/workflows');
  return fs
    .readdirSync(workflowsDir)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .map((entry) => `.github/workflows/${entry}`);
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

    assert.match(action, /github-token:/);
    assert.match(
      action,
      /GITHUB_TOKEN_VALUE: \$\{\{ inputs\.github-token \}\}/,
    );
    assert.match(action, /GIT_ASKPASS="\$askpass_path"/);
    assert.doesNotMatch(
      action,
      /git config --local http\.https:\/\/github\.com\/\.extraheader "AUTHORIZATION:/,
    );
    assert.match(
      action,
      /git[\s\S]*-c http\.https:\/\/github\.com\/\.extraheader=[\s\S]*-c http\.extraheader=[\s\S]*-c credential\.helper=[\s\S]*push origin "HEAD:\$BRANCH"/,
    );
    assert.match(action, /Sanitized push auth diagnostics/);
    assert.match(action, /github-token input present:/);
    assert.match(action, /GIT_ASKPASS configured:/);
    assert.match(action, /visible git http extraheader keys:/);
    assert.match(action, /commit_created=false/);
    assert.match(action, /origin\/HEAD\.\.HEAD/);
    assert.match(action, /Branch is not ahead of origin\/\$BRANCH/);
    assert.match(action, /failure-reason:/);
    assert.match(action, /workflow-permission/);
    assert.match(action, /GitHub rejected the active push credential/);
  });

  it('classifies workflow-file push rejections for GitHub App, OAuth App, and classic PAT tokens', () => {
    const action = readRepoFile('.github/actions/commit-and-push/action.yml');

    // Read the classifier regex straight from the production action so this
    // test fails if the regex drifts away from real GitHub rejection wording.
    const grepMatch = action.match(
      /if grep -Eqi '([^']*)' "\$log_file"; then\s+printf '%s\\n' workflow-permission/,
    );
    assert.ok(
      grepMatch,
      'classify_push_failure must define a grep -Eqi pattern',
    );
    const classifier = new RegExp(grepMatch[1], 'i');

    const rejections = [
      'refusing to allow a GitHub App to create or update workflow `.github/workflows/fix-review.yml` without `workflows` permission',
      'refusing to allow an OAuth App to create or update workflow `.github/workflows/fix-review.yml` without `workflow` scope',
      'refusing to allow a Personal Access Token to create or update workflow `.github/workflows/fix-review.yml` without `workflow` scope',
    ];
    for (const message of rejections) {
      assert.match(message, classifier, `classifier must catch: ${message}`);
    }

    assert.doesNotMatch(
      ' ! [remote rejected] HEAD -> codex/foo (non-fast-forward)',
      classifier,
    );
  });

  it('surfaces fix-review workflow-file push grant failures in the sticky comment', () => {
    const workflow = readRepoFile('.github/workflows/fix-review.yml');

    assert.match(
      workflow,
      /PUSH_FAILURE_REASON: \$\{\{ steps\.push\.outputs\.failure-reason \}\}/,
    );
    assert.match(workflow, /--push-failure-reason "\$PUSH_FAILURE_REASON"/);
    assert.doesNotMatch(
      workflow,
      /exclude-paths:[\s\S]*\.github\/workflows/,
      'fix-review must keep workflow-file fixes committable',
    );
  });

  it('passes GH_PAT to every automation commit-and-push callsite', () => {
    for (const workflowPath of listWorkflowFiles()) {
      const workflow = readRepoFile(workflowPath);
      const uses = 'uses: ./.github/actions/commit-and-push';
      let searchFrom = 0;

      while (true) {
        const usesIndex = workflow.indexOf(uses, searchFrom);
        if (usesIndex === -1) {
          break;
        }

        const nextStepIndex = workflow.indexOf('\n      - ', usesIndex + 1);
        const block = workflow.slice(
          usesIndex,
          nextStepIndex === -1 ? workflow.length : nextStepIndex,
        );

        assert.match(
          block,
          /github-token: \$\{\{ secrets\.GH_PAT \}\}/,
          `${workflowPath} commit-and-push callsite must pass GH_PAT`,
        );

        searchFrom = usesIndex + uses.length;
      }
    }
  });

  it('validates and repairs GSD executions before pushing a PR branch', () => {
    const workflow = readRepoFile('.github/workflows/gsd-planning-execute.yml');
    const validateIndex = workflow.indexOf('name: Validate execution output');
    const executionCommitIndex = workflow.indexOf(
      "commit-message: 'feat(gsd): execute planning intake'",
    );

    assert.ok(validateIndex > 0, 'validation step must exist');
    assert.ok(
      executionCommitIndex > validateIndex,
      'validation must run before execution commit',
    );
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

  it('persists no-op planning execution state through a reviewable PR', () => {
    const workflow = readRepoFile('.github/workflows/gsd-planning-execute.yml');
    const detectIndex = workflow.indexOf('id: code-changes');
    const noOpPushIndex = workflow.indexOf('id: push-plan-state');
    const noOpPrIndex = workflow.indexOf('name: Create no-op persistence PR');

    assert.ok(detectIndex > 0, 'code change detection must exist');
    assert.ok(
      noOpPushIndex > detectIndex,
      'no-op planning state push must run after change detection',
    );
    assert.ok(
      noOpPrIndex > noOpPushIndex,
      'no-op persistence PR must be created after push',
    );
    assert.match(
      workflow,
      /git diff --name-only HEAD -- \. ':\(exclude\)\.planning\/'/,
    );
    assert.match(
      workflow,
      /git ls-files --others --exclude-standard -- \. ':\(exclude\)\.planning\/'/,
    );
    assert.match(
      workflow,
      /if: steps\.code-changes\.outputs\.has_code_changes == 'false'[\s\S]*branch-name: \$\{\{ steps\.branch\.outputs\.branch_name \}\}/,
    );
    assert.match(
      workflow,
      /title: 'chore\(planning\): track execution queue plan - \$\{\{ steps\.intake\.outputs\.source_title \}\}'/,
    );
    assert.doesNotMatch(workflow, /git push origin main/);
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
