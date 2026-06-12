import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('docker-image workflow', () => {
  it('keeps classify, validation, and publish on self-hosted runners', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github/workflows/docker-image.yml'),
      'utf8',
    );

    assert.match(workflow, /classify:[\s\S]*?runs-on:\s+self-hosted/);
    assert.match(
      workflow,
      /docker-build:[\s\S]*?runs-on:\s+\[self-hosted,\s*big\]/,
    );
    assert.match(workflow, /publish:[\s\S]*?runs-on:\s+\[self-hosted,\s*big\]/);
    assert.doesNotMatch(workflow, /runs-on:\s+ubuntu-/);
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
