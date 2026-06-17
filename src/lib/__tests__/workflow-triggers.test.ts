import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as {
  load(source: string): unknown;
};

type PullRequestTrigger = {
  types?: string[];
};

type Workflow = {
  on?: {
    pull_request?: PullRequestTrigger;
    pull_request_target?: PullRequestTrigger;
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
  return yaml.load(fs.readFileSync(workflowPath, 'utf8')) as Workflow;
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

  it('keeps non-review comments from cancelling active code-review runs', () => {
    const workflow = readWorkflow('code-review.yml');
    const group = workflow.concurrency?.group ?? '';

    assert.match(group, /github\.event_name == 'issue_comment'/);
    assert.match(
      group,
      /contains\(github\.event\.comment\.body, '\/review'\)/,
    );
    assert.match(group, /code-review-ignored-\{0\}/);
    assert.match(group, /code-review-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
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
  });

  it('prefilters review and orchestrator issue comments before resolver setup', () => {
    expectGuard('code-review.yml', [
      /resolve-pr:[\s\S]*?if: >-/,
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
      /node \.github\/workflows\/scripts\/evaluate-trigger-policy\.cjs[\s\S]*?--mode pr-flow-approve/,
    ]);
  });
});
