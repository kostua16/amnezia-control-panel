import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetResourceMonitorForTests,
  __setResourceMonitorDepsForTests,
  getSystemResources,
} from '../resource-monitor';

describe('getSystemResources', () => {
  beforeEach(() => {
    __resetResourceMonitorForTests();
  });

  afterEach(() => {
    __resetResourceMonitorForTests();
  });

  it('dedupes concurrent refreshes after a cache miss', async () => {
    let resolveDiskUsage:
      | ((value: { stdout: string; stderr: string }) => void)
      | undefined;
    const execCommand = mock.fn(
      async (_cmd: string, _args: string[], _options: { timeoutMs: number }) =>
        new Promise<{ stdout: string; stderr: string }>((resolve) => {
          resolveDiskUsage = resolve;
        }),
    );

    __setResourceMonitorDepsForTests({ execCommand });

    const first = getSystemResources();
    const second = getSystemResources();

    assert.equal(execCommand.mock.callCount(), 1);
    assert.ok(resolveDiskUsage);
    resolveDiskUsage({
      stdout:
        'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 100 25 75 25% /\n',
      stderr: '',
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.strictEqual(firstResult, secondResult);
    assert.equal(firstResult.disk.total, 100 * 1024);
    assert.equal(firstResult.disk.used, 25 * 1024);
    assert.equal(firstResult.disk.free, 75 * 1024);
    assert.equal(firstResult.disk.percent, 25);
  });

  it('serves cache hits without running disk collection again', async () => {
    const execCommand = mock.fn(
      async (
        _cmd: string,
        _args: string[],
        _options: { timeoutMs: number },
      ) => ({
        stdout:
          'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 200 50 150 25% /\n',
        stderr: '',
      }),
    );

    __setResourceMonitorDepsForTests({ execCommand });

    const first = await getSystemResources();
    const second = await getSystemResources();

    assert.strictEqual(first, second);
    assert.equal(execCommand.mock.callCount(), 1);
  });
});
