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
    const workflowPath = path.join(
      repoRoot,
      '.github/workflows',
      'pr-flow.yml',
    );
    const workflow = fs.readFileSync(workflowPath, 'utf8');

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
      /!contains\(github\.event\.comment\.body, '\/review'\)/,
    );
    assert.match(group, /code-review-ignored-\{0\}/);
    assert.match(group, /code-review-\{0\}/);
    assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  });
});
