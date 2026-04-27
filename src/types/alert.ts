import type { AlertSeverity } from '@/generated/prisma/enums';

export interface Alert {
  id: number;
  type: string;
  severity: AlertSeverity;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

export interface AlertSummary {
  total: number;
  unread: number;
  critical: number;
  warning: number;
}
