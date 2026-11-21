import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function listWorkflowFiles(): string[] {
  return fs
    .readdirSync(path.join(process.cwd(), '.github/workflows'))
    .filter((file) => file.endsWith('.yml'))
    .sort();
}

describe('workflow runner labels', () => {
  it('runs every job on the plain ubuntu-latest GitHub-hosted runner', () => {
    const offenders: string[] = [];
    let found = 0;

    for (const file of listWorkflowFiles()) {
      const lines = readRepoFile(`.github/workflows/${file}`).split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*runs-on:\s*(.+)$/);
        if (!match) continue;
        found += 1;
        if (match[1].trim() !== 'ubuntu-latest') {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    assert.ok(found > 0, 'at least one runs-on line must be found');
    assert.deepEqual(offenders, [], `non ubuntu-latest runs-on: ${offenders}`);
  });

  it('declares no self-hosted runner labels for actionlint', () => {
    const config = readRepoFile('.github/actionlint.yaml');

    assert.doesNotMatch(config, /^self-hosted-runner:/m);
  });
});
