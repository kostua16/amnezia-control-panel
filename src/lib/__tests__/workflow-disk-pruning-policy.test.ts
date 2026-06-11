import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('workflow disk pruning policy', () => {
  it('keeps pruning repo-local caches when the runner remains below the free-space floor', () => {
    const action = readRepoFile('.github/actions/setup-environment/action.yml');

    assert.match(
      action,
      /Disk still below threshold after standard local-cache pruning/,
    );
    assert.match(action, /Removing emergency local-cache entry:/);
    assert.match(
      action,
      /for \(\(i = last_remaining_index; i >= 0; i--\)\); do/,
    );
    assert.match(
      action,
      /Disk space remains below threshold after emergency local-cache pruning:/,
    );
  });
});
