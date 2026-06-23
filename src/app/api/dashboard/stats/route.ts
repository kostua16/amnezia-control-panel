import { success, error } from '@/lib/api-response';
import { getDashboardStats } from '@/lib/dashboard-stats';
import { getCachedDashboardStats } from '@/lib/real-time-broadcaster';

/** Freshness window for the broadcaster's cached dashboard snapshot (60s). */
const DASHBOARD_CACHE_TTL_MS = 60_000;

/**
 * Dashboard stats.
 * Serves the broadcaster's cached snapshot when fresh to avoid re-running the
 * traffic aggregate query on every poll, otherwise falls back to a fresh query.
 * Both paths return the full DashboardStats shape.
 */
export async function GET() {
  try {
    const cached = getCachedDashboardStats();
    if (cached && Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL_MS) {
      return success({ ...cached.stats, cached: true });
    }

    const stats = await getDashboardStats();
    return success({ ...stats, cached: false });
  } catch (err) {
    console.error('[api/dashboard/stats] Error:', err);
    return error('Failed to fetch dashboard stats');
  }
}
