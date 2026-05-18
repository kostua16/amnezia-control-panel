import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAlert, getAlerts } from '@/lib/alert-service';
import { success, error } from '@/lib/api-response';

const alertSeverityEnum = z.enum(['INFO', 'WARNING', 'CRITICAL']);

const listAlertsSchema = z.object({
  isRead: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  severity: alertSeverityEnum.optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createAlertSchema = z.object({
  type: z.string().min(1, 'Type is required'),
  severity: alertSeverityEnum.default('INFO'),
  message: z.string().min(1, 'Message is required'),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = listAlertsSchema.safeParse(params);

    if (!parsed.success) {
      return error('Invalid query parameters', 422);
    }

    const { isRead, severity, type, limit, offset } = parsed.data;

    const result = await getAlerts({
      isRead: isRead as boolean | undefined,
      severity,
      type,
      limit,
      offset,
    });

    return success({
      alerts: result.alerts,
      pagination: {
        limit,
        offset,
        total: result.total,
        unreadCount: result.unreadCount,
      },
    });
  } catch (err) {
    console.error('[api/alerts] GET error:', err);
    return error('Failed to fetch alerts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createAlertSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return error(firstError, 422);
    }

    const { type, severity, message } = parsed.data;
    const alert = await createAlert(type, severity, message);

    return success(alert, 'Alert created', 201);
  } catch (err) {
    console.error('[api/alerts] POST error:', err);
    return error('Failed to create alert');
  }
}
