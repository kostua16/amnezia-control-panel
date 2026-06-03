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
});
