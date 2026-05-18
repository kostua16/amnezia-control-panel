import { prisma } from '@/lib/prisma';
import { broadcastEvent } from '@/lib/websocket';
import type { AlertSeverity } from '@/generated/prisma/enums';

export interface AlertData {
  id: number;
  type: string;
  severity: AlertSeverity;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface GetAlertsOptions {
  isRead?: boolean;
  severity?: AlertSeverity;
  type?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create a new alert and broadcast it via WebSocket.
 */
export async function createAlert(
  type: string,
  severity: AlertSeverity,
  message: string,
): Promise<AlertData> {
  const alert = await prisma.alert.create({
    data: { type, severity, message },
  });

  const alertData = toAlertData(alert);

  // Broadcast to all connected WebSocket clients
  broadcastEvent('alert:new', alertData);

  return alertData;
}

/**
 * List alerts with optional filters.
 */
export async function getAlerts(options: GetAlertsOptions = {}): Promise<{
  alerts: AlertData[];
  total: number;
  unreadCount: number;
}> {
  const { isRead, severity, type, limit = 50, offset = 0 } = options;

  const where: Record<string, unknown> = {};
  if (isRead !== undefined) where.isRead = isRead;
  if (severity) where.severity = severity;
  if (type) where.type = type;

  const [alerts, total, unreadCount] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.alert.count({ where }),
    prisma.alert.count({ where: { isRead: false } }),
  ]);

  return {
    alerts: alerts.map(toAlertData),
    total,
    unreadCount,
  };
}

/**
 * Mark a single alert as read.
 */
export async function markAlertRead(id: number): Promise<AlertData | null> {
  const alert = await prisma.alert
    .update({
      where: { id },
      data: { isRead: true },
    })
    .catch(() => null);

  return alert ? toAlertData(alert) : null;
}

/**
 * Mark all alerts as read.
 */
export async function markAllRead(): Promise<number> {
  const result = await prisma.alert.updateMany({
    where: { isRead: false },
    data: { isRead: true },
  });

  return result.count;
}

/**
 * Delete an alert.
 */
export async function deleteAlert(id: number): Promise<boolean> {
  try {
    await prisma.alert.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Count unread alerts.
 */
export async function getUnreadCount(): Promise<number> {
  return prisma.alert.count({ where: { isRead: false } });
}

function toAlertData(alert: {
  id: number;
  type: string;
  severity: AlertSeverity;
  message: string;
  isRead: boolean;
  createdAt: Date;
}): AlertData {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    isRead: alert.isRead,
    createdAt: alert.createdAt.toISOString(),
  };
}
