import { success, error } from '@/lib/api-response';
import { getSystemResources } from '@/lib/resource-monitor';

export async function GET() {
  try {
    const resources = await getSystemResources();
    return success(resources);
  } catch (err) {
    console.error('[api/monitoring/resources] Error:', err);
    return error('Failed to fetch system resources');
  }
}
