import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  execCommand,
  execCommandSync,
  CommandError,
  isWindows,
} from '../command-executor';

const NODE = process.execPath;

describe('execCommand', () => {
  it('captures stdout on success', async () => {
    const result = await execCommand(NODE, [
      '-e',
      "process.stdout.write('hello')",
    ]);

    assert.strictEqual(result.stdout, 'hello');
  });

  it('throws CommandError whose message includes the command name', async () => {
    await assert.rejects(
      () => execCommand('definitely-not-a-real-bin-xyz', ['--flag']),
      (err: unknown) => {
        assert.ok(err instanceof CommandError);
        assert.strictEqual(err.code, 'ENOENT');
        assert.ok(
          err.message.includes('definitely-not-a-real-bin-xyz'),
          `message missing command name: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws CommandError on non-zero exit', async () => {
    await assert.rejects(
      () => execCommand(NODE, ['-e', 'process.exit(2)']),
      (err: unknown) => {
        assert.ok(err instanceof CommandError);
        assert.ok(err.message.includes(NODE));
        return true;
      },
    );
  });

  it('throws CommandError when the timeout elapses', async () => {
    await assert.rejects(
      () =>
        execCommand(NODE, ['-e', 'setTimeout(() => {}, 60000)'], {
          timeoutMs: 80,
        }),
      (err: unknown) => {
        assert.ok(err instanceof CommandError);
        return true;
      },
    );
  });
});

describe('execCommandSync', () => {
  it('captures stdout on success', () => {
    const result = execCommandSync(NODE, [
      '-e',
      "process.stdout.write('sync-ok')",
    ]);

    assert.strictEqual(result.stdout, 'sync-ok');
  });

  it('throws CommandError on non-zero exit', () => {
    assert.throws(
      () => execCommandSync(NODE, ['-e', 'process.exit(3)']),
      (err: unknown) => {
        assert.ok(err instanceof CommandError);
        assert.ok(err.message.includes(NODE));
        return true;
      },
    );
  });
});

describe('isWindows', () => {
  it('matches process.platform', () => {
    assert.strictEqual(isWindows(), process.platform === 'win32');
  });
});
