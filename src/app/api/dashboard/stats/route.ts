import { success, error } from '@/lib/api-response';
import { getDashboardStats } from '@/lib/dashboard-stats';

export async function GET() {
  try {
    return success(await getDashboardStats());
  } catch (err) {
    console.error('[api/dashboard/stats] Error:', err);
    return error('Failed to fetch dashboard stats');
  }
}
