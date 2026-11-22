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

describe('setup-environment on GitHub-hosted runners', () => {
  const actionPath = '.github/actions/setup-environment/action.yml';

  it('carries no disk pruning or repo-local cache machinery', () => {
    const action = readRepoFile(actionPath);

    assert.doesNotMatch(action, /maxnowack\/local-cache/);
    assert.doesNotMatch(action, /minimum-disk-space-mb/);
    assert.doesNotMatch(action, /local-cache-entries-to-keep/);
    assert.doesNotMatch(action, /Ensure minimum disk space/);
  });

  it('caches node_modules, Next.js and rtk through SHA-pinned actions/cache', () => {
    const action = readRepoFile(actionPath);
    const pinned = action.match(/uses: actions\/cache@[0-9a-f]{40}/g) ?? [];

    assert.equal(pinned.length, 3);
    assert.doesNotMatch(action, /uses: actions\/cache@(?![0-9a-f]{40})/);
  });

  it('installs a checksum-verified actionlint only when requested', () => {
    const action = readRepoFile(actionPath);

    assert.match(
      action,
      /install-actionlint:\s*\r?\n\s+description:[^\n]*\n\s+default: 'false'/,
    );
    assert.match(action, /if: inputs\.install-actionlint == 'true'/);

    const stepStart = action.indexOf('name: Install actionlint');
    assert.ok(stepStart > -1, 'install step must exist');
    const step = action.slice(stepStart);
    const verifyIndex = step.indexOf('sha256sum -c');
    const extractIndex = step.indexOf('tar -xzf');
    assert.ok(verifyIndex > -1, 'checksum verification must exist');
    assert.ok(extractIndex > -1, 'tarball extraction must exist');
    assert.ok(
      verifyIndex < extractIndex,
      'the tarball must be verified before it is extracted',
    );
  });

  it('opts the monitor and audit-auto-prs workflows into actionlint', () => {
    for (const file of [
      'monitor-amnezia-control-panel-github-runs.yml',
      'audit-auto-prs.yml',
    ]) {
      const workflow = readRepoFile(`.github/workflows/${file}`);

      assert.match(workflow, /install-actionlint: 'true'/, file);
    }
  });
});
