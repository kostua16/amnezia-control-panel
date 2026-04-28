import { checkResourceThresholds } from '@/lib/resource-alerts';
import { success, error } from '@/lib/api-response';

export async function POST() {
  try {
    const results = await checkResourceThresholds();

    return success({
      checks: results.checks,
      alertsCreated: results.alertsCreated,
    }, `Resource check complete: ${results.alertsCreated} alerts created`);
  } catch (err) {
    console.error('[api/alerts/resource-check] POST error:', err);
    return error('Failed to run resource check');
  }
}
