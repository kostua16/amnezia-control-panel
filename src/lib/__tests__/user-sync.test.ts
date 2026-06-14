import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncUser, __setDeps, __resetDeps } from '../user-sync';
import type { SyncUser, UserSyncDeps } from '../user-sync';
import type { VpnServiceResult } from '../vpn-services';

/**
 * Coverage for user-sync reconciliation (DB block state ↔ VPN service state).
 *
 * syncUser reads the user via an injected findUser and drives block/unblock
 * through injected VPN service stubs, so the reconciliation matrix is tested
 * without a live database or VPN backend. Mirrors the scenarios the
 * architectural review flagged as untested: blocked→VPN block,
 * active→VPN unblock, and the no-protocols warning.
 */

function ok(message: string): VpnServiceResult {
  return { success: true, message };
}
function fail(message: string): VpnServiceResult {
  return { success: false, message };
}

function makeUser(overrides: Partial<SyncUser>): SyncUser {
  return {
    id: 1,
    username: 'alice',
    isActive: true,
    isBlocked: false,
    protocols: [],
    ...overrides,
  };
}

function makeDeps(
  findUser: (id: number) => Promise<SyncUser | null>,
  vpn: Partial<UserSyncDeps> = {},
): UserSyncDeps {
  return {
    findUser,
    blockAwgUser: vpn.blockAwgUser ?? (async () => ok('blocked awg')),
    unblockAwgUser: vpn.unblockAwgUser ?? (async () => ok('unblocked awg')),
    blockThreeXuiUser:
      vpn.blockThreeXuiUser ?? (async () => ok('blocked 3x-ui')),
    unblockThreeXuiUser:
      vpn.unblockThreeXuiUser ?? (async () => ok('unblocked 3x-ui')),
  };
}

describe('syncUser', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
    console.log = mock.fn<typeof console.log>();
    console.error = mock.fn<typeof console.error>();
  });

  afterEach(() => {
    __resetDeps();
    console.log = originalLog;
    console.error = originalError;
  });

  it('blocks every active VPN service for a DB-blocked user', async () => {
    const calls: Array<[string, string]> = [];
    __setDeps(
      makeDeps(
        async () =>
          makeUser({
            isBlocked: true,
            protocols: [{ serviceType: 'AWG' }, { serviceType: 'THREE_XUI' }],
          }),
        {
          blockAwgUser: async (u) => {
            calls.push(['block', 'AWG']);
            return ok(`blocked ${u} awg`);
          },
          blockThreeXuiUser: async (u) => {
            calls.push(['block', 'THREE_XUI']);
            return ok(`blocked ${u} 3x-ui`);
          },
        },
      ),
    );

    const report = await syncUser(1);

    assert.equal(report.checked, 1);
    assert.equal(report.fixed, 2, 'both services should be blocked');
    assert.equal(report.errors.length, 0);
    assert.deepEqual(
      calls,
      [
        ['block', 'AWG'],
        ['block', 'THREE_XUI'],
      ],
      'should block AWG then THREE_XUI',
    );
    assert.ok(
      report.details.every((d) => d.action === 'block-vpn'),
      'every detail should record a block-vpn action',
    );
  });

  it('unblocks every active VPN service for an active user', async () => {
    const calls: Array<[string, string]> = [];
    __setDeps(
      makeDeps(
        async () =>
          makeUser({
            isBlocked: false,
            protocols: [{ serviceType: 'AWG' }, { serviceType: 'THREE_XUI' }],
          }),
        {
          unblockAwgUser: async (u) => {
            calls.push(['unblock', 'AWG']);
            return ok(`unblocked ${u} awg`);
          },
          unblockThreeXuiUser: async (u) => {
            calls.push(['unblock', 'THREE_XUI']);
            return ok(`unblocked ${u} 3x-ui`);
          },
        },
      ),
    );

    const report = await syncUser(1);

    assert.equal(report.fixed, 2, 'both services should be unblocked');
    assert.equal(report.errors.length, 0);
    assert.deepEqual(calls, [
      ['unblock', 'AWG'],
      ['unblock', 'THREE_XUI'],
    ]);
    assert.ok(
      report.details.every((d) => d.action === 'unblock-vpn'),
      'every detail should record an unblock-vpn action',
    );
  });

  it('records a no-protocols warning for an active user with no VPN protocols', async () => {
    __setDeps(makeDeps(async () => makeUser({ protocols: [] })));

    const report = await syncUser(1);

    assert.equal(report.fixed, 0);
    assert.equal(report.errors.length, 0);
    assert.ok(
      report.details.some((d) => d.action === 'no-protocols'),
      'should flag the missing-protocols state',
    );
  });

  it('reports an error when the user is not found', async () => {
    __setDeps(makeDeps(async () => null));

    const report = await syncUser(999);

    assert.equal(report.checked, 1);
    assert.equal(report.fixed, 0);
    assert.ok(
      report.errors.some((e) => /not found/i.test(e)),
      'should report that the user was not found',
    );
  });

  it('records a VPN failure as an error without incrementing the fix count', async () => {
    __setDeps(
      makeDeps(
        async () =>
          makeUser({
            isBlocked: true,
            protocols: [{ serviceType: 'AWG' }],
          }),
        {
          blockAwgUser: async () => fail('awg CLI missing'),
        },
      ),
    );

    const report = await syncUser(1);

    assert.equal(report.fixed, 0, 'a failed block is not a fix');
    assert.ok(
      report.errors.some((e) => /awg CLI missing/.test(e)),
      'should surface the VPN failure message',
    );
    assert.equal(report.details.length, 0, 'no successful action recorded');
  });

  it('skips protocol types that are not AWG or THREE_XUI', async () => {
    const calls: string[] = [];
    __setDeps(
      makeDeps(
        async () =>
          makeUser({
            isBlocked: true,
            protocols: [{ serviceType: 'UNKNOWN' }, { serviceType: 'AWG' }],
          }),
        {
          blockAwgUser: async () => {
            calls.push('awg');
            return ok('blocked');
          },
        },
      ),
    );

    const report = await syncUser(1);

    assert.equal(report.fixed, 1, 'only the AWG protocol should be acted on');
    assert.deepEqual(calls, ['awg']);
  });
});
