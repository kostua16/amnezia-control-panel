import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { load as loadYaml } from 'js-yaml';

type PullRequestTrigger = {
  types?: string[];
};

type Workflow = {
  on?: {
    issue_comment?: PullRequestTrigger;
    pull_request?: PullRequestTrigger;
    pull_request_target?: PullRequestTrigger;
    workflow_run?: unknown;
    schedule?: unknown;
    workflow_dispatch?: unknown;
  };
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean | string;
  };
  jobs?: {
    orchestrate?: {
      if?: string;
    };
  };
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function readWorkflow(fileName: string): Workflow {
  const workflowPath = path.join(repoRoot, '.github/workflows', fileName);
  return loadYaml(fs.readFileSync(workflowPath, 'utf8')) as Workflow;
}

function readWorkflowText(fileName: string): string {
  return fs.readFileSync(
    path.join(repoRoot, '.github/workflows', fileName),
    'utf8',
  );
}

function expectGuard(fileName: string, patterns: RegExp[]) {
  const workflow = readWorkflowText(fileName);

  for (const pattern of patterns) {
    assert.match(workflow, pattern, fileName);
  }
}

describe('workflow trigger policy', () => {
  it('does not rerun heavy CI when a draft PR is marked ready', () => {
    const workflow = readWorkflow('ci.yml');
    const types = workflow.on?.pull_request?.types ?? [];

    assert.deepEqual(types, ['opened', 'synchronize', 'reopened']);
    assert.ok(!types.includes('ready_for_review'));
  });

  it('keeps draft-to-ready transitions in the lightweight PR orchestrator', () => {
    const workflow = readWorkflow('pr-flow.yml');
    const types = workflow.on?.pull_request_target?.types ?? [];

    assert.ok(types.includes('ready_for_review'));
  });

  it('skips label-triggered PR flow jobs while the PR is still draft', () => {
    const workflow = readWorkflow('pr-flow.yml');
    const guard = workflow.jobs?.orchestrate?.if ?? '';

    assert.match(guard, /github\.event\.action != 'labeled'/);
    assert.match(guard, /github\.event\.action != 'unlabeled'/);
    assert.match(guard, /github\.event\.pull_request\.draft != true/);
  });

  it('classifies PR label triggers before allocating the orchestrator runner', () => {
    const workflow = readWorkflowText('pr-flow.yml');

    assert.match(workflow, /classify-trigger:[\s\S]*?runs-on:\s+self-hosted/);
    assert.match(
      workflow,
      /should_run:\s+\$\{\{\s*steps\.classify\.outputs\.should_run\s*\}\}/,
    );
    assert.match(workflow, /needs:\s+classify-trigger/);
    assert.match(
      workflow,
      /needs\.classify-trigger\.outputs\.should_run == 'true'/,
    );
  });

  it('keeps Code Review dispatch-only so /review identity comes from PR Flow', () => {
    const workflow = readWorkflow('code-review.yml');
    const group = workflow.concurrency?.group ?? '';
    const triggers = workflow.on ?? {};

    assert.equal(triggers.issue_comment, undefined);
    assert.ok(triggers.workflow_dispatch);
    assert.match(group, /github\.event\.inputs\.pr_number/);
    assert.match(group, /code-review-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  });

  it('keeps non-command, bot, and non-PR comments from cancelling active deepseek-code-review runs', () => {
    const workflow = readWorkflow('deepseek-code-review.yml');
    const group = workflow.concurrency?.group ?? '';

    assert.match(group, /github\.event_name == 'issue_comment'/);
    assert.match(group, /github\.event\.issue\.pull_request != null/);
    assert.match(group, /github\.event\.comment\.user\.type != 'Bot'/);
    assert.match(
      group,
      /contains\(github\.event\.comment\.body, '\/deepseek-review'\)/,
    );
    assert.match(group, /deepseek-code-review-ignored-\{0\}/);
    assert.match(group, /deepseek-code-review-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  });

  it('keeps non-command, bot, and non-PR comments from cancelling active fix-review runs', () => {
    const workflow = readWorkflow('fix-review.yml');
    const group = workflow.concurrency?.group ?? '';

    assert.match(group, /github\.event_name == 'issue_comment'/);
    assert.match(group, /github\.event\.issue\.pull_request != null/);
    assert.match(group, /github\.event\.comment\.user\.type != 'Bot'/);
    assert.match(
      group,
      /contains\(github\.event\.comment\.body, '\/fix-review'\)/,
    );
    assert.match(
      group,
      /contains\(github\.event\.comment\.body, '\/address-review'\)/,
    );
    assert.match(group, /fix-review-ignored-\{0\}/);
    assert.match(group, /fix-review-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  });

  it('keeps auto-cover-review event-driven with scheduled fallback and main-ref repair dispatch', () => {
    const workflow = readWorkflow('auto-cover-review.yml');
    const yaml = readWorkflowText('auto-cover-review.yml');
    const fixReviewYaml = readWorkflowText('fix-review.yml');

    assert.ok(workflow.on?.workflow_run);
    assert.deepEqual(workflow.on?.issue_comment?.types, ['created', 'edited']);
    assert.ok(workflow.on?.schedule);
    assert.ok(workflow.on?.workflow_dispatch);
    assert.match(yaml, /workflows: \['Code Review'\]/);
    assert.match(
      yaml,
      /github\.event\.comment\.user\.login == 'kilo-code-bot\[bot\]'/,
    );
    assert.match(
      yaml,
      /contains\(github\.event\.comment\.body, '<!-- kilo-review -->'\)/,
    );
    assert.match(yaml, /group: auto-cover-review-/);
    assert.match(
      yaml,
      /gh workflow run fix-review\.yml\s+\\\n\s+--ref main\s+\\\n\s+-f pr_number="\$pr_number"\s+\\\n\s+-f head_sha="\$head_sha"\s+\\\n\s+-f automation_review_loop=true/,
    );
    assert.match(
      yaml,
      /fix_review_title="Fix Review PR #\$\{pr_number\} @ \$\{head_sha\}"/,
    );
    assert.match(
      yaml,
      /gh run list\s+\\\n\s+--workflow fix-review\.yml\s+\\\n\s+--event workflow_dispatch/,
    );
    assert.match(yaml, /\.displayTitle == \$title/);
    assert.match(yaml, /\.createdAt >= \$started/);
    assert.match(yaml, /echo "- Dispatcher run:/);
    assert.match(yaml, /echo "- Fix-review run:/);
    assert.match(
      fixReviewYaml,
      /allowed-bots:\s+\$\{\{\s+github\.event\.inputs\.automation_review_loop == 'true' && 'github-actions,github-actions\[bot\],claude\[bot\]' \|\| ''\s+\}\}/,
    );
  });

  it('wakes PR Flow from created or edited Kilo sticky comments only', () => {
    const workflow = readWorkflow('pr-flow.yml');
    const yaml = readWorkflowText('pr-flow.yml');

    assert.deepEqual(workflow.on?.issue_comment?.types, ['created', 'edited']);
    assert.match(
      yaml,
      /github\.event\.comment\.user\.login == 'kilo-code-bot\[bot\]'/,
    );
    assert.match(
      yaml,
      /contains\(github\.event\.comment\.body, '<!-- kilo-review -->'\)/,
    );
  });

  it('keeps non-command, bot, and non-PR comments from cancelling active rebase-pr runs', () => {
    const workflow = readWorkflow('rebase-pr.yml');
    const group = workflow.concurrency?.group ?? '';

    assert.match(group, /github\.event_name == 'issue_comment'/);
    assert.match(group, /github\.event\.issue\.pull_request != null/);
    assert.match(group, /github\.event\.comment\.user\.type != 'Bot'/);
    // rebase-pr uses an exact-body match (== '/rebase'), so prose mentions and
    // "/rebase main" do not share the PR-wide group and cannot cancel a run.
    assert.match(group, /github\.event\.comment\.body == '\/rebase'/);
    assert.match(group, /rebase-pr-ignored-\{0\}/);
    assert.match(group, /rebase-pr-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  });

  it('rebase-pr skipped summary names the specific blocking condition', () => {
    // The skipped step must forward the eligibility reason so the sticky summary
    // states which condition blocked the rebase (draft / do-not-merge / stale
    // head / cross-repo / closed / merged) instead of the generic cause list.
    const yaml = readWorkflowText('rebase-pr.yml');
    assert.match(yaml, /REASON: \$\{\{ steps\.pr\.outputs\.reason \}\}/);
    assert.match(yaml, /--reason "\$REASON"/);
  });

  it('rebase-pr auto-resolves trivial conflicts before invoking ZAI', () => {
    const yaml = readWorkflowText('rebase-pr.yml');

    assert.match(yaml, /id: autoresolve/);
    assert.match(
      yaml,
      /\$REBASE_CONTROL_DIR\/scripts\/auto-resolve-trivial-rebase-conflicts\.cjs" >> "\$GITHUB_OUTPUT"/,
    );
    assert.match(
      yaml,
      /Post conflict-working[\s\S]*steps\.autoresolve\.outputs\.rebase_complete != 'true'/,
    );
    assert.match(
      yaml,
      /Resolve conflicts with ZAI[\s\S]*steps\.autoresolve\.outputs\.rebase_complete != 'true'/,
    );
    assert.match(
      yaml,
      /steps\.attempt\.outputs\.rebase_state == 'conflict' && steps\.autoresolve\.outputs\.rebase_complete == 'true'/,
    );
    assert.match(
      yaml,
      /--trivial-conflicts-auto-resolved "\$TRIVIAL_CONFLICTS_AUTO_RESOLVED"/,
    );
  });

  it('keeps rebase-pr resolver commands inside the Bash allowlist', () => {
    const yaml = readWorkflowText('rebase-pr.yml');

    assert.match(yaml, /Bash\(git -c core\.editor=true rebase --continue:\*\)/);
    assert.match(
      yaml,
      /Do not call absolute binaries such as `\/usr\/bin\/node`/,
    );
    assert.match(yaml, /do not use pipes, shell control operators/);
    assert.match(yaml, /Use `rtk node --test \.\.\.` or `rtk npm \.\.\.`/);
    assert.match(yaml, /run `npm run format:check` before finishing/);
    assert.match(yaml, /run `npm run format`/);
    assert.match(
      yaml,
      /Leave full CI-matching validation beyond that targeted fast feedback to the workflow's `validate-pr-gate` step/,
    );
  });

  it('prefilters standalone AI mention workflows before runner checkout', () => {
    expectGuard('claude.yml', [
      /authorize:[\s\S]*?if: >-/,
      /contains\(github\.event\.comment\.body, '@claude'\)/,
      /contains\(github\.event\.review\.body, '@claude'\)/,
      /contains\(github\.event\.issue\.title, '@claude'\)/,
      /contains\(github\.event\.issue\.body, '@claude'\)/,
    ]);
    expectGuard('deepseek.yml', [
      /authorize:[\s\S]*?if: >-/,
      /contains\(github\.event\.comment\.body, '@deepseek'\)/,
      /contains\(github\.event\.review\.body, '@deepseek'\)/,
      /contains\(github\.event\.issue\.title, '@deepseek'\)/,
      /contains\(github\.event\.issue\.body, '@deepseek'\)/,
    ]);
    expectGuard('antigravity.yml', [
      /authorize:[\s\S]*?if: >-/,
      /contains\(github\.event\.comment\.body, '@gemini'\)/,
      /contains\(github\.event\.comment\.body, '@antigravity'\)/,
      /contains\(github\.event\.review\.body, '@gemini'\)/,
      /contains\(github\.event\.review\.body, '@antigravity'\)/,
      /contains\(github\.event\.issue\.title, '@gemini'\)/,
      /contains\(github\.event\.issue\.body, '@antigravity'\)/,
    ]);
  });

  it('prefilters issue command workflows before runner checkout', () => {
    expectGuard('fix-issue.yml', [
      /authorize:[\s\S]*?if: >-/,
      /github\.event\.issue\.pull_request == null/,
      /contains\(github\.event\.comment\.body, '\/fix'\)/,
      /github\.event\.label\.name == 'auto-fix-approved'/,
    ]);
    expectGuard('approve-auto-fix.yml', [
      /authorize:[\s\S]*?if: >-/,
      /github\.event\.issue\.pull_request == null/,
      /contains\(github\.event\.comment\.body, '\/approve-auto-fix'\)/,
    ]);
    expectGuard('gsd-planning.yml', [
      /authorize:[\s\S]*?if: >-/,
      /github\.event_name == 'workflow_dispatch'/,
      /startsWith\(github\.event\.comment\.body, '\/gsd-plan'\)/,
    ]);
    expectGuard('triage.yml', [
      /triage:[\s\S]*?if: \|/,
      /github\.event\.issue\.pull_request == null/,
      /startsWith\(github\.event\.comment\.body, '\/triage'\)/,
    ]);
  });

  it('prefilters review and orchestrator issue comments before resolver setup', () => {
    expectGuard('pr-flow.yml', [
      /classify-trigger:[\s\S]*?if: >-/,
      /github\.event\.issue\.pull_request != null/,
      /contains\(github\.event\.comment\.body, '\/review'\)/,
    ]);
    expectGuard('deepseek-code-review.yml', [
      /resolve-pr:[\s\S]*?if: >-/,
      /github\.event\.issue\.pull_request != null/,
      /contains\(github\.event\.comment\.body, '\/deepseek-review'\)/,
    ]);
    expectGuard('antigravity-code-review.yml', [
      /authorize:[\s\S]*?if: >-/,
      /github\.event_name == 'workflow_dispatch'/,
      /github\.event\.issue\.pull_request != null/,
      /contains\(github\.event\.comment\.body, '\/gemini-review'\)/,
    ]);
    expectGuard('pr-flow.yml', [
      /classify-trigger:[\s\S]*?if: >-/,
      /github\.event\.issue\.pull_request != null/,
      /contains\(github\.event\.comment\.body, '\/approve'\)/,
      /contains\(github\.event\.comment\.body, '\/review'\)/,
      /node \.github\/workflows\/scripts\/evaluate-trigger-policy\.cjs[\s\S]*?--mode pr-flow-control/,
    ]);
  });

  // §5 cancellation cascade — locks the pr-flow prt/wake/noise design.
  it('isolates prt and wake concurrency in pr-flow (cancellation cascade)', () => {
    const workflow = readWorkflowText('pr-flow.yml');
    // prt (pull_request_target), reactive wakes, and github-actions[bot]
    // comment noise run in separate groups: a wake can never cancel an
    // in-flight prt orchestrate, and a no-op bot comment can never cancel or
    // displace a queued real wake (concurrency applies at run creation,
    // before job `if:` gates evaluate).
    assert.match(
      workflow,
      /group: pr-flow-\$\{\{ \(github\.event_name == 'pull_request_target' && 'prt'\) \|\| \(github\.event_name == 'issue_comment' && github\.event\.comment\.user\.login == 'github-actions\[bot\]' && 'noise'\) \|\| 'wake' \}/,
    );
    // Only prt opened/synchronize/ready_for_review cancel an older prt (a new
    // commit restarts orchestration); prt labeled/unlabeled do NOT
    // (anti-thrash, since orchestrate itself adds flow/* labels), and wakes
    // never cancel an in-flight run — an in-progress wake always finishes
    // while queued wakes collapse newest-wins via pending-run replacement.
    assert.match(
      workflow,
      /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request_target' && github\.event\.action != 'labeled' && github\.event\.action != 'unlabeled' \}\}/,
    );
  });

  // P0-1b — heavy CI jobs are gated on the `changes` job, so docs-only changes
  // skip them; skipped required checks are non-blocking (P0-1a).
  it('gates heavy CI jobs on the changes-detection job (docs-only skips heavy CI)', () => {
    const ci = readWorkflowText('ci.yml');
    assert.match(ci, /\n  changes:/);
    assert.match(ci, /run-heavy/);
    const gates = ci.match(/needs: \[changes\]/g) ?? [];
    assert.equal(gates.length, 5);
    assert.match(ci, /if: needs\.changes\.outputs\.run-heavy == 'true'/);
  });

  // P0-4 — fix-review's heavy job is time-boxed so it can't hog a big runner.
  it('time-boxes the fix-review heavy job', () => {
    const fr = readWorkflowText('fix-review.yml');
    const timeouts = [...fr.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const maxTimeout = Math.max(...timeouts);
    assert.ok(
      maxTimeout <= 30,
      `fix-review heavy job timeout ${maxTimeout} > 30 (would hog a big runner)`,
    );
  });

  // P1-4 — pull_request_target must stay on the base ref: never check out / run
  // untrusted PR-head code with the workflow's token (injection vector). The
  // pattern is hoisted+shared so the coverage test locks the SAME regex the guard
  // uses; the prt workflow list is discovered dynamically so new ones are covered.
  const PR_HEAD_CHECKOUT_PATTERN =
    /ref:\s*\$\{\{[^}]*(?:pull_request\.head\.sha|head_ref|head\.ref)/;

  it('keeps pull_request_target workflows on the base ref (no PR-head checkout)', () => {
    const workflowsDir = path.join(repoRoot, '.github/workflows');
    const prtWorkflows = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml'))
      .filter((f) =>
        /pull_request_target/.test(
          fs.readFileSync(path.join(workflowsDir, f), 'utf8'),
        ),
      );
    assert.ok(
      prtWorkflows.length > 0,
      'expected to find pull_request_target workflows to guard',
    );
    for (const f of prtWorkflows) {
      const y = fs.readFileSync(path.join(workflowsDir, f), 'utf8');
      assert.ok(
        !PR_HEAD_CHECKOUT_PATTERN.test(y),
        `${f} checks out the PR head (sha/ref/branch) under pull_request_target (injection risk)`,
      );
    }
  });

  it('the pull_request_target guard catches every PR-head checkout token', () => {
    for (const dangerous of [
      'ref: ${{ github.event.pull_request.head.sha }}',
      'ref: ${{ github.event.pull_request.head.ref }}',
      'ref: ${{ github.head_ref }}',
    ]) {
      assert.ok(
        PR_HEAD_CHECKOUT_PATTERN.test(dangerous),
        `guard must catch: ${dangerous}`,
      );
    }
    assert.ok(!PR_HEAD_CHECKOUT_PATTERN.test('ref: ${{ github.ref }}'));
    assert.ok(!PR_HEAD_CHECKOUT_PATTERN.test('ref: ${{ github.base_ref }}'));
  });
});
