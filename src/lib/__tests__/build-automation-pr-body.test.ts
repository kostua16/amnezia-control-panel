import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  REQUIRED_HEADINGS,
  buildAutomationPrBody,
  extractFinalResultFromExecutionText,
  parseChangedFiles,
  validateRichBody,
} = require('../../../.github/workflows/scripts/build-automation-pr-body.cjs');

function tempFile(content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-pr-body-'));
  const filePath = path.join(dir, 'execution.jsonl');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('buildAutomationPrBody', () => {
  it('extracts the final model result from execution JSONL', () => {
    const executionText = [
      JSON.stringify({ type: 'assistant', message: { content: 'working' } }),
      JSON.stringify({
        type: 'result',
        result:
          'Added `contents: read` because checkout lost default contents permission.',
      }),
    ].join('\n');

    assert.equal(
      extractFinalResultFromExecutionText(executionText),
      'Added `contents: read` because checkout lost default contents permission.',
    );
  });

  it('builds a workflow-health body with run evidence and changed files', () => {
    const executionFile = tempFile(
      JSON.stringify({
        type: 'result',
        result:
          'All 3 Approve Auto-Fix runs failed at checkout. The workflow only declared `issues: write`, removing default `contents: read`.',
      }),
    );

    const body = buildAutomationPrBody({
      workflowName: 'workflow-health-optimize',
      problem: 'Scheduled workflow health analysis found failed workflow runs.',
      sourceRunUrl:
        'https://github.com/kostua16/amnezia-control-panel/actions/runs/26981685761',
      changedFiles: JSON.stringify(['.github/workflows/approve-auto-fix.yml']),
      evidence:
        '[{"name":"Approve Auto-Fix","status":"failure","failedJobs":[{"name":"approve"}]}]',
      executionFile,
      reviewNotes: 'Draft PR; confirm the run evidence before merging.',
    });

    for (const heading of REQUIRED_HEADINGS) {
      assert.match(body, new RegExp(heading.replace('/', '\\/')));
    }
    assert.match(body, /All 3 Approve Auto-Fix runs failed/);
    assert.match(body, /approve-auto-fix\.yml/);
    assert.match(body, /26981685761/);
    validateRichBody(body);
  });

  it('renders CI auto-fix evidence, closing issues, and redacts secrets', () => {
    const body = buildAutomationPrBody({
      workflowName: '_auto-fix-ci',
      problem: 'CI failed on branch `main`.',
      rationale: 'Fixed the type error reported by CI.',
      changedFiles: 'src/lib/server.ts\nsrc/lib/client.ts',
      sourceRunUrl: 'https://github.com/example/repo/actions/runs/42',
      sourcePrUrl: 'https://github.com/example/repo/pull/5',
      failedJobs: '["test"]',
      errorLogs:
        '##[error]src/lib/server.ts:1:1 error TS2322 api_key=super-secret-token',
      affectedFiles: 'src/lib/server.ts',
      closingIssues: '33,34',
      reviewNotes:
        'Workflow and planning changes remain manual-only under repository policy.',
    });

    assert.match(body, /Failed jobs:/);
    assert.match(body, /src\/lib\/server\.ts/);
    assert.match(body, /Closes #33/);
    assert.match(body, /Closes #34/);
    assert.doesNotMatch(body, /super-secret-token/);
    assert.match(body, /api_key=\[REDACTED\]/);
    validateRichBody(body);
  });

  it('builds an issue-fix body from structured output and issue context', () => {
    const body = buildAutomationPrBody({
      workflowName: 'fix-issue',
      problem: 'Fix requested for issue #122: Repair startup failure',
      sourceIssueUrl: 'https://github.com/example/repo/issues/122',
      structuredOutput: JSON.stringify({
        rationale: 'The startup failure was caused by a missing null guard.',
      }),
      changedFiles: 'src/server/start.ts',
      evidence: 'Fix instruction: repair the startup failure',
      closingIssues: '122',
      reviewNotes:
        'Created from a maintainer-approved fix trigger. Review against the issue conversation.',
    });

    assert.match(body, /Repair startup failure/);
    assert.match(body, /missing null guard/);
    assert.match(body, /Closes #122/);
    validateRichBody(body);
  });

  it('truncates long evidence blocks', () => {
    const body = buildAutomationPrBody({
      workflowName: 'docs-drift',
      problem: 'Documentation drift was detected.',
      rationale: 'Updated docs to match implementation.',
      changedFiles: 'docs/setup.md',
      evidence: `${'x'.repeat(5000)}\nsk-1234567890abcdef`,
      reviewNotes: 'Manual review required.',
    });

    assert.match(body, /\[truncated for PR body\]/);
    assert.doesNotMatch(body, /sk-1234567890abcdef/);
    validateRichBody(body);
  });

  it('validates required rich body sections', () => {
    assert.throws(
      () => validateRichBody('short body'),
      /missing required section/,
    );
  });

  it('normalizes changed files from JSON and comma lists', () => {
    assert.deepEqual(parseChangedFiles('b.ts,a.ts,b.ts'), ['a.ts', 'b.ts']);
    assert.deepEqual(parseChangedFiles(JSON.stringify([{ path: 'c.ts' }])), [
      'c.ts',
    ]);
  });
});
