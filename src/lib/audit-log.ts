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

let auditTableReady: Promise<void> | null = null;

async function ensureAuditLogTable(): Promise<void> {
  auditTableReady ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resourceId TEXT,
        actor TEXT NOT NULL DEFAULT 'admin',
        outcome TEXT NOT NULL DEFAULT 'success',
        metadata TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource, resourceId)',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(createdAt)',
    );
  })();

  return auditTableReady;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await ensureAuditLogTable();

    await prisma.$executeRaw`
      INSERT INTO audit_logs (action, resource, resourceId, actor, outcome, metadata)
      VALUES (
        ${input.action},
        ${input.resource},
        ${input.resourceId == null ? null : String(input.resourceId)},
        ${input.actor ?? 'admin'},
        ${input.outcome ?? 'success'},
        ${input.metadata ? JSON.stringify(input.metadata) : null}
      )
    `;
  } catch (error) {
    console.error('[audit-log] Failed to write audit event:', error);
  }
}
