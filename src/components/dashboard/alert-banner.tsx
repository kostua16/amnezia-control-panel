'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  useAlerts,
  useAlertUnreadCount,
  useMarkAlertRead,
  useMarkAllAlertsRead,
  useDeleteAlert,
} from '@/hooks/use-alerts';
import type { AlertData } from '@/lib/alert-service';

const severityConfig: Record<
  string,
  {
    icon: typeof Info;
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
  }
> = {
  INFO: {
    icon: Info,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    label: 'Info',
  },
  WARNING: {
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/20',
    label: 'Warning',
  },
  CRITICAL: {
    icon: AlertCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    label: 'Critical',
  },
};

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

function AlertItem({
  alert,
  onMarkRead,
  onDelete,
}: {
  alert: AlertData;
  onMarkRead: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const config = severityConfig[alert.severity] ?? severityConfig.INFO;
  const Icon = config.icon;

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-md border p-3 transition-colors',
        config.borderColor,
        alert.isRead ? 'opacity-60' : config.bgColor,
      )}
    >
      <Icon className={clsx('h-4 w-4 mt-0.5 shrink-0', config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs font-medium uppercase', config.color)}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(alert.createdAt)}
          </span>
        </div>
        <p className="text-sm text-foreground mt-0.5 break-words">
          {alert.message}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!alert.isRead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(alert.id);
            }}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Mark as read"
          >
            <CheckCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(alert.id);
          }}
          className="p-1 rounded hover:bg-muted transition-colors"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

export function AlertBanner() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: alertsData, isLoading } = useAlerts({ limit: 20 });
  const { data: unreadCount = 0 } = useAlertUnreadCount();
  const markRead = useMarkAlertRead();
  const markAllRead = useMarkAllAlertsRead();
  const deleteAlert = useDeleteAlert();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const alerts = alertsData?.data.alerts ?? [];

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Alerts${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border border-border bg-card shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Alerts</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                disabled={markAllRead.isPending}
              >
                {markAllRead.isPending ? 'Marking...' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* Alert list */}
          <div className="max-h-80 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No alerts</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    onMarkRead={(id) => markRead.mutate(id)}
                    onDelete={(id) => deleteAlert.mutate(id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
