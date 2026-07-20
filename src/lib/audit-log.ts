import { prisma } from '@/lib/prisma';

export type AuditOutcome = 'success' | 'failure';

export interface AuditLogInput {
  action: string;
  resource: string;
  resourceId?: string | number | null;
  outcome?: AuditOutcome;
  actor?: string;
  metadata?: Record<string, unknown> | null;
}

/** Consecutive audit-write failure counter (module-scoped). */
let consecutiveFailures = 0;

/**
 * Threshold before emitting a CRITICAL alert about audit write failures.
 * After 3 consecutive failures the audit trail is likely broken.
 */
const AUDIT_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Check whether the audit log table is writable by attempting an
 * idempotent read. Returns `true` when the table is reachable.
 */
export async function isAuditTableWritable(): Promise<boolean> {
  try {
    await prisma.auditLog.findFirst({ take: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId == null ? null : String(input.resourceId),
        actor: input.actor ?? 'admin',
        outcome: input.outcome ?? 'success',
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    // Reset counter on success
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    console.error(
      `[audit-log] Failed to write audit event (${consecutiveFailures} consecutive):`,
      error,
    );

    if (consecutiveFailures === AUDIT_FAILURE_ALERT_THRESHOLD) {
      try {
        // Dynamic import avoids circular dependency at module load time
        const { createAlert } = await import('@/lib/alert-service');
        await createAlert(
          'audit-log-health',
          'CRITICAL',
          'Audit log write failures detected — compliance trail may be incomplete',
        );
      } catch (alertErr) {
        console.error(
          '[audit-log] Failed to emit audit-health alert:',
          alertErr,
        );
      }
    }
  }
}
