import { prisma } from '@/lib/prisma';
import { getAdapter, isSupportedServiceType } from '@/lib/vpn-service-adapter';
import type { VpnServiceResult } from '@/lib/vpn-services';

export interface SyncReport {
  checked: number;
  fixed: number;
  errors: string[];
  details: Array<{
    userId: number;
    username: string;
    action: string;
    description: string;
  }>;
}

// ─── Test support: injectable sync dependencies ────────

/**
 * Narrow view of a user record used by syncUser. Only the fields the
 * reconciliation logic reads, so tests can inject a minimal fixture instead
 * of a full Prisma row.
 */
export interface SyncUser {
  id: number;
  username: string;
  isActive: boolean;
  isBlocked: boolean;
  protocols: Array<{ serviceType: string }>;
}

/**
 * Dependency surface for user-state reconciliation. In production the defaults
 * read from the real database and call the real VPN services via the adapter;
 * tests inject fakes so block/unblock scenarios are deterministic without a live DB.
 */
export interface UserSyncDeps {
  findUser: (userId: number) => Promise<SyncUser | null>;
  blockUser: (
    username: string,
    serviceType: string,
  ) => Promise<VpnServiceResult>;
  unblockUser: (
    username: string,
    serviceType: string,
  ) => Promise<VpnServiceResult>;
}

let _deps: UserSyncDeps | null = null;

/** @internal — inject mock dependencies for testing */
export function __setDeps(deps: UserSyncDeps): void {
  _deps = deps;
}

/** @internal — restore production dependencies */
export function __resetDeps(): void {
  _deps = null;
}

async function defaultFindUser(userId: number): Promise<SyncUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      protocols: { where: { isActive: true }, select: { serviceType: true } },
    },
  });
}

/** Resolve the active dependency set, falling back to production defaults. */
function resolveDeps(): UserSyncDeps {
  return (
    _deps ?? {
      findUser: defaultFindUser,
      blockUser: (username, serviceType) =>
        getAdapter(serviceType).block(username),
      unblockUser: (username, serviceType) =>
        getAdapter(serviceType).unblock(username),
    }
  );
}

/**
 * Sync a single user's state between DB and VPN services.
 *
 * Checks:
 * - Is user blocked in DB but not in VPN? → block in VPN
 * - Is user active in DB but blocked in VPN? → unblock in VPN (soft fix, logged)
 * - Does user have active protocols in DB but missing in VPN? → logged as warning
 *
 * NOTE: Full VPN state reconciliation (e.g., checking actual VPN peer lists) requires
 * real VPN status query commands. Currently logs discrepancies for manual review.
 *
 * Only actively-provisioned protocols are reconciled (the queries below filter on
 * isActive: true). The user-creation route marks a protocol inactive when its remote
 * service could not be provisioned, so a partially-provisioned user is never assumed
 * to have live VPN access for the services that failed. Do not widen this filter to
 * "all protocols" — that would re-mask provisioning failures by attempting to unblock
 * services that were never created.
 */
export async function syncUser(userId: number): Promise<SyncReport> {
  const report: SyncReport = {
    checked: 1,
    fixed: 0,
    errors: [],
    details: [],
  };

  try {
    const deps = resolveDeps();
    const user = await deps.findUser(userId);

    if (!user) {
      report.errors.push(`User ${userId} not found in database`);
      return report;
    }

    // Check block state consistency
    if (user.isBlocked) {
      // User is blocked in DB — ensure blocked in VPN services
      for (const protocol of user.protocols) {
      if (!isSupportedServiceType(protocol.serviceType)) continue;
        try {
          const result = await deps.blockUser(
            user.username,
            protocol.serviceType,
          );

          if (result.success) {
            report.details.push({
              userId: user.id,
              username: user.username,
              action: 'block-vpn',
              description: `Ensured ${protocol.serviceType} block for ${user.username}`,
            });
            report.fixed++;
          } else {
            report.errors.push(
              `Failed to block ${protocol.serviceType} for ${user.username}: ${result.message}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          report.errors.push(
            `Error blocking ${protocol.serviceType} for ${user.username}: ${msg}`,
          );
        }
      }
    } else {
      // User is active in DB — ensure unblocked in VPN services
      for (const protocol of user.protocols) {
      if (!isSupportedServiceType(protocol.serviceType)) continue;
        try {
          const result = await deps.unblockUser(
            user.username,
            protocol.serviceType,
          );

          if (result.success) {
            report.details.push({
              userId: user.id,
              username: user.username,
              action: 'unblock-vpn',
              description: `Ensured ${protocol.serviceType} unblock for ${user.username}`,
            });
            report.fixed++;
          } else {
            report.errors.push(
              `Failed to unblock ${protocol.serviceType} for ${user.username}: ${result.message}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          report.errors.push(
            `Error unblocking ${protocol.serviceType} for ${user.username}: ${msg}`,
          );
        }
      }
    }

    // Check protocol consistency
    // Log users with no active protocols as a potential issue
    if (user.protocols.length === 0 && user.isActive) {
      report.details.push({
        userId: user.id,
        username: user.username,
        action: 'no-protocols',
        description: `Active user ${user.username} has no assigned VPN protocols`,
      });
    }

    console.log(
      `[user-sync] Synced user ${user.username} (ID: ${userId}): ${report.fixed} fixes, ${report.errors.length} errors`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(`Failed to sync user ${userId}: ${msg}`);
    console.error(`[user-sync] Error syncing user ${userId}:`, err);
  }

  return report;
}

/**
 * Sync all users between DB and VPN services.
 * Processes users sequentially because VPN services share mutable backends.
 */
export async function syncAllUsers(): Promise<SyncReport> {
  const totalReport: SyncReport = {
    checked: 0,
    fixed: 0,
    errors: [],
    details: [],
  };

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: {
        protocols: { where: { isActive: true }, select: { serviceType: true } },
      },
    });

    console.log(`[user-sync] Starting sync of ${users.length} active users`);

    for (const user of users) {
      try {
        const userReport = await syncUser(user.id);
        totalReport.checked += userReport.checked;
        totalReport.fixed += userReport.fixed;
        totalReport.errors.push(...userReport.errors);
        totalReport.details.push(...userReport.details);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        totalReport.errors.push(reason);
      }
    }

    console.log(
      `[user-sync] Sync complete: ${totalReport.checked} checked, ${totalReport.fixed} fixed, ${totalReport.errors.length} errors`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    totalReport.errors.push(`Failed to sync all users: ${msg}`);
    console.error('[user-sync] Error in syncAllUsers:', err);
  }

  return totalReport;
}
