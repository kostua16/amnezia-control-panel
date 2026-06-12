import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('docker-image workflow', () => {
  it('runs classify, validation, and publish on GitHub-hosted runners', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/docker-image.yml'),
      'utf8',
    );

    assert.match(workflow, /classify:[\s\S]*?runs-on:\s+ubuntu-24\.04/);
    assert.match(workflow, /docker-build:[\s\S]*?runs-on:\s+ubuntu-24\.04/);
    assert.match(workflow, /publish:[\s\S]*?runs-on:\s+ubuntu-24\.04/);
    assert.doesNotMatch(workflow, /runs-on:\s+\[self-hosted,\s*big\]/);
  });

  it('skips registry attestations for user-owned private repositories', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/docker-image.yml'),
      'utf8',
    );

    assert.match(
      workflow,
      /Generate artifact attestation[\s\S]*?if:\s+\$\{\{\s*!github\.event\.repository\.private\s+\|\|\s+github\.event\.repository\.owner\.type\s+!=\s+'User'\s*\}\}/,
    );
  });
});
