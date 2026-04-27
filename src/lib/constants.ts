/** VPN service types supported by the panel */
export const VPN_SERVICES = {
  AWG: 'AWG',
  THREE_XUI: 'THREE_XUI',
} as const;

/** Default traffic quota: 10 GB in bytes */
export const DEFAULT_TRAFFIC_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** Default speed limit: 0 means unlimited */
export const DEFAULT_SPEED_LIMIT_KBPS = 0;

/** Alert severity levels ordered by urgency */
export const ALERT_SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'INFO'] as const;

/** Traffic stat periods available for queries */
export const TRAFFIC_PERIODS = ['hourly', 'daily', 'weekly', 'monthly'] as const;

export type VpnService = (typeof VPN_SERVICES)[keyof typeof VPN_SERVICES];
export type TrafficPeriod = (typeof TRAFFIC_PERIODS)[number];
