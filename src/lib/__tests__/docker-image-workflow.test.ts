import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('docker-image workflow', () => {
  function readWorkflow() {
    return fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/docker-image.yml'),
      'utf8',
    );
  }

  function escapeRegex(value: string) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }

  function globToRegExp(glob: string) {
    let regex = '^';
    for (let index = 0; index < glob.length; index += 1) {
      const char = glob[index];
      const next = glob[index + 1];
      if (char === '*' && next === '*') {
        regex += '.*';
        index += 1;
      } else if (char === '*') {
        regex += '[^/]*';
      } else {
        regex += escapeRegex(char);
      }
    }
    return new RegExp(`${regex}$`);
  }

  function extractRelevantGlobs(workflow: string) {
    const match = workflow.match(/const relevantGlobs = \[([\s\S]*?)\];/);
    assert.ok(match, 'relevantGlobs array exists');
    return [...match[1].matchAll(/'([^']+)'/g)].map((glob) => glob[1]);
  }

  it('keeps classify, validation, and publish on self-hosted runners', () => {
    const workflow = readWorkflow();

    assert.match(workflow, /classify:[\s\S]*?runs-on:\s+self-hosted/);
    assert.match(
      workflow,
      /docker-build:[\s\S]*?runs-on:\s+\[self-hosted,\s*big\]/,
    );
    assert.match(workflow, /publish:[\s\S]*?runs-on:\s+\[self-hosted,\s*big\]/);
    assert.doesNotMatch(workflow, /runs-on:\s+ubuntu-/);
  });

  it('keeps Docker path gating inside jobs instead of workflow triggers', () => {
    const workflow = readWorkflow();
    const triggerBlock = workflow.slice(
      workflow.indexOf('on:'),
      workflow.indexOf('permissions:'),
    );

    assert.doesNotMatch(triggerBlock, /\n\s+paths:/);
    assert.doesNotMatch(triggerBlock, /\n\s+paths-ignore:/);
    assert.match(
      workflow,
      /docker-build:[\s\S]*?if:\s+needs\.classify\.outputs\.should_validate\s+==\s+'true'/,
    );
    assert.match(
      workflow,
      /publish:[\s\S]*?if:\s+needs\.classify\.outputs\.should_publish\s+==\s+'true'/,
    );
  });

  it('matches representative Docker image input paths in the classifier', () => {
    const workflow = readWorkflow();
    const relevantPatterns = extractRelevantGlobs(workflow).map(globToRegExp);
    const isRelevant = (filePath: string) =>
      relevantPatterns.some((pattern) => pattern.test(filePath));

    assert.equal(isRelevant('src/app/page.tsx'), true);
    assert.equal(isRelevant('Dockerfile'), true);
    assert.equal(isRelevant('package-lock.json'), true);
    assert.equal(isRelevant('prisma/schema.prisma'), true);
    assert.equal(isRelevant('docs/workflow.md'), false);
    assert.match(workflow, /pulls\.listFiles/);
    assert.match(workflow, /compareCommitsWithBasehead/);
  });

  it('skips registry attestations for user-owned private repositories', () => {
    const workflow = readWorkflow();

    assert.match(
      workflow,
      /Generate artifact attestation[\s\S]*?if:\s+\$\{\{\s*!github\.event\.repository\.private\s+\|\|\s+github\.event\.repository\.owner\.type\s+!=\s+'User'\s*\}\}/,
    );
  });
});
