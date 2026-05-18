import { checkUserQuotas } from '@/lib/quota-monitor';
import { success, error } from '@/lib/api-response';

export async function POST() {
  try {
    const results = await checkUserQuotas();

    return success(
      {
        checked: results.checked,
        alertsCreated: results.alertsCreated,
        details: results.details,
      },
      `Quota check complete: ${results.checked} users checked, ${results.alertsCreated} alerts created`,
    );
  } catch (err) {
    console.error('[api/alerts/quota-check] POST error:', err);
    return error('Failed to run quota check');
  }
}
