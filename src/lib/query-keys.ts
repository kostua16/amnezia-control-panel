/**
 * Centralized React Query key registry.
 *
 * Single source of truth for all query keys. Hooks spread base keys
 * with parameters for parameterized queries; invalidation uses the
 * base key directly for prefix matching.
 */

export const queryKeys = {
  /** Dashboard overview statistics */
  dashboardStats: ['dashboard-stats'] as const,

  /** Alert list — spread with params: [...queryKeys.alerts, params] */
  alerts: ['alerts'] as const,

  /** Alert unread count badge */
  alertsUnreadCount: ['alerts-unread-count'] as const,

  /** User list — spread with params: [...queryKeys.users, params] */
  users: ['users'] as const,

  /** Per-service status — spread with key: [...queryKeys.serviceStatus, key] */
  serviceStatus: ['service-status'] as const,

  /** Multi-panel fleet status */
  fleetStatus: ['fleet-status'] as const,

  /** System resource monitoring (CPU, memory, disk) */
  systemResources: ['system-resources'] as const,

  /** Traffic statistics — spread with params: [...queryKeys.trafficStats, params] */
  trafficStats: ['traffic-stats'] as const,

  /** Top users by traffic — spread with args: [...queryKeys.topUserTraffic, limit, period] */
  topUserTraffic: ['top-user-traffic'] as const,
} as const;
