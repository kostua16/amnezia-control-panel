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
  } catch (error) {
    console.error('[audit-log] Failed to write audit event:', error);
  }
}
