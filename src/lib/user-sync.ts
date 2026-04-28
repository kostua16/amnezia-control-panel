import { prisma } from '@/lib/prisma';
import {
  blockAwgUser,
  unblockAwgUser,
  blockThreeXuiUser,
  unblockThreeXuiUser,
} from '@/lib/vpn-services';

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
 */
export async function syncUser(userId: number): Promise<SyncReport> {
  const report: SyncReport = {
    checked: 1,
    fixed: 0,
    errors: [],
    details: [],
  };

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        protocols: { where: { isActive: true }, select: { serviceType: true } },
      },
    });

    if (!user) {
      report.errors.push(`User ${userId} not found in database`);
      return report;
    }

    // Check block state consistency
    if (user.isBlocked) {
      // User is blocked in DB — ensure blocked in VPN services
      for (const protocol of user.protocols) {
        // Attempt to block (idempotent in VPN services)
        try {
          let result;
          if (protocol.serviceType === 'AWG') {
            result = await blockAwgUser(user.username);
          } else if (protocol.serviceType === 'THREE_XUI') {
            result = await blockThreeXuiUser(user.username);
          } else {
            continue;
          }

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
        try {
          let result;
          if (protocol.serviceType === 'AWG') {
            result = await unblockAwgUser(user.username);
          } else if (protocol.serviceType === 'THREE_XUI') {
            result = await unblockThreeXuiUser(user.username);
          } else {
            continue;
          }

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
 * Processes users sequentially to avoid overwhelming VPN services.
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
      const userReport = await syncUser(user.id);
      totalReport.checked += userReport.checked;
      totalReport.fixed += userReport.fixed;
      totalReport.errors.push(...userReport.errors);
      totalReport.details.push(...userReport.details);
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
