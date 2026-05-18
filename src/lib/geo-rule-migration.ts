import { prisma } from '@/lib/prisma';

/** Migration result for logging */
export interface MigrationResult {
  migrated: number;
  skipped: string[];
  errors: string[];
}

/**
 * Ensure v1.0 in-memory geo rules are migrated to SQLite.
 *
 * Since the old API routes used module-scoped arrays (not persisted),
 * actual migration can only happen if old data was somehow persisted.
 * This function checks if the geo_routing_rules table is empty and
 * logs the migration status. In a real upgrade scenario, this would
 * be called from an API endpoint or startup hook.
 *
 * Per D-17: log counts and failures.
 */
export async function ensureGeoRulesMigrated(): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: [], errors: [] };

  try {
    const existing = await prisma.geoRoutingRule.count();
    if (existing > 0) {
      result.skipped.push(
        `Table already has ${existing} rules, skipping migration`,
      );
      return result;
    }

    // No in-memory data to migrate (module-scoped arrays are lost on restart).
    result.skipped.push(
      'No in-memory geo rules found to migrate (expected on fresh install or post-restart)',
    );
    console.log(
      '[geo-migration] Migration check complete: table is empty, no in-memory data available',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);
    console.error('[geo-migration] Migration failed:', message);
  }

  return result;
}
