import { markAllRead } from '@/lib/alert-service';
import { success, error } from '@/lib/api-response';

export async function POST() {
  try {
    const count = await markAllRead();
    return success({ markedRead: count }, `${count} alerts marked as read`);
  } catch (err) {
    console.error('[api/alerts/read-all] POST error:', err);
    return error('Failed to mark all alerts as read');
  }
}
