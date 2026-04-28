import { NextRequest } from 'next/server';
import { z } from 'zod';
import { markAlertRead, deleteAlert } from '@/lib/alert-service';
import { success, error } from '@/lib/api-response';

const paramsSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    const alert = await markAlertRead(id);
    if (!alert) {
      return error('Alert not found', 404);
    }

    return success(alert);
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      return error('Invalid alert ID', 422);
    }
    console.error('[api/alerts/[id]] PUT error:', err);
    return error('Failed to mark alert as read');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    const deleted = await deleteAlert(id);
    if (!deleted) {
      return error('Alert not found', 404);
    }

    return success(null, 'Alert deleted');
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      return error('Invalid alert ID', 422);
    }
    console.error('[api/alerts/[id]] DELETE error:', err);
    return error('Failed to delete alert');
  }
}
