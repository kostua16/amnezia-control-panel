/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

function hasPermission(content, permission) {
  return new RegExp(`^  ${permission}:`, 'm').test(content);
}

function hasWakeOrchestratorJob(content) {
  return /wake-orchestrator:/.test(content);
}

function hasOrchestratedInput(content) {
  return /orchestrated:/.test(content);
}

/**
 * pr-flow.json lists workers with `workflow:` fields. Each worker
 * that can be dispatched by the orchestrator must:
 *   1. Have `actions: write` permission (needed for `gh workflow run`)
 *   2. Have `orchestrated` workflow_dispatch input
 *   3. Have a `wake-orchestrator` job that re-dispatches pr-flow.yml
 */
test('all dispatched workers have wake-orchestrator contract', () => {
  const prFlowConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.github/pr-flow.json'), 'utf8'),
  );

  const dispatchedWorkers = Object.entries(prFlowConfig.workers || {})
    .filter(([, cfg]) => cfg.workflow)
    .map(([name, cfg]) => ({ name, workflow: cfg.workflow }));

  // antigravityCodeReview has no workflow file but is a valid worker (optional, external label-based).
  // Only test workers that have a `workflow:` pointing to a local file.
  const violations = [];

  for (const worker of dispatchedWorkers) {
    const filePath = path.join(workflowsDir, worker.workflow);
    if (!fs.existsSync(filePath)) {
      violations.push(
        `${worker.name}: workflow file '${worker.workflow}' does not exist`,
      );
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (!hasPermission(content, 'actions')) {
      violations.push(
        `${worker.name} (${worker.workflow}): missing top-level 'actions' permission`,
      );
    }

    if (!hasOrchestratedInput(content)) {
      violations.push(
        `${worker.name} (${worker.workflow}): missing 'orchestrated' workflow_dispatch input`,
      );
    }

    if (!hasWakeOrchestratorJob(content)) {
      violations.push(
        `${worker.name} (${worker.workflow}): missing 'wake-orchestrator' job`,
      );
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Worker wake-up contract violations:\n${violations.join('\n')}`,
  );
});

test('wake-orchestrator jobs dispatch pr-flow.yml with dry_run=false', () => {
  const prFlowConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.github/pr-flow.json'), 'utf8'),
  );

  const dispatchedWorkers = Object.entries(prFlowConfig.workers || {})
    .filter(([, cfg]) => cfg.workflow)
    .map(([, cfg]) => cfg.workflow);

  const uniqueWorkflows = [...new Set(dispatchedWorkers)];
  const violations = [];

  for (const wf of uniqueWorkflows) {
    const filePath = path.join(workflowsDir, wf);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');

    if (hasWakeOrchestratorJob(content)) {
      if (!/gh workflow run pr-flow\.yml/.test(content)) {
        violations.push(
          `${wf}: wake-orchestrator does not dispatch 'pr-flow.yml'`,
        );
      }
      if (!/-f dry_run=false/.test(content)) {
        violations.push(`${wf}: wake-orchestrator does not pass dry_run=false`);
      }
      // Gate may span multiple lines (YAML folded block scalar), so
      // check for the presence of the pattern anywhere in the file.
      if (!/orchestrated\s*==\s*'true'/.test(content)) {
        violations.push(
          `${wf}: wake-orchestrator is not gated on orchestrated=true`,
        );
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Wake-orchestrator dispatch violations:\n${violations.join('\n')}`,
  );
});

test('pr-flow.yml workflow_run trigger includes PR Policy', () => {
  const prFlowYml = fs.readFileSync(
    path.join(workflowsDir, 'pr-flow.yml'),
    'utf8',
  );

  // Capture the entire workflow_run trigger block (up to the next top-level key).
  const triggerBlock = prFlowYml.match(
    /workflow_run:[\s\S]*?(?=\n  workflow_dispatch:|\npermissions:)/,
  );
  assert.ok(
    triggerBlock,
    'workflow_run trigger block not found in pr-flow.yml',
  );
  // Match "PR Policy" regardless of YAML quote style (single, double, or none)
  // so a formatter-driven quote switch can't make this regression test fail
  // spuriously while the trigger still lists PR Policy.
  assert.ok(
    /['"]?PR Policy['"]?/.test(triggerBlock[0]),
    'pr-flow.yml workflow_run trigger must include PR Policy to wake orchestration after policy checks complete',
  );
});

test('edit-capable fix-review agent uses workflow-triggering credentials', () => {
  const fixReviewYml = fs.readFileSync(
    path.join(workflowsDir, 'fix-review.yml'),
    'utf8',
  );

  const applyReviewFixesStep = fixReviewYml.match(
    /- name: Apply review fixes[\s\S]*?(?=\n      - name:|\n      - uses:|\n  [a-zA-Z0-9_-]+:|$)/,
  );
  assert.ok(
    applyReviewFixesStep,
    'fix-review.yml must define the Apply review fixes step',
  );
  assert.match(
    applyReviewFixesStep[0],
    /github-token:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}/,
    'fix-review.yml Apply review fixes must pass GH_PAT so any edit-capable agent tooling uses a credential that wakes downstream PR checks',
  );
  assert.doesNotMatch(
    applyReviewFixesStep[0],
    /github-token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/,
    'fix-review.yml Apply review fixes must not pass GITHUB_TOKEN to edit-capable agent tooling',
  );
});
