/**
 * Centralized environment variable declarations and startup validation.
 *
 * Declares all required and optional env vars with their types, defaults,
 * and descriptions. Call `validateEnvironment()` at startup (from
 * instrumentation.node.ts) to fail fast on missing required vars.
 */

// ─── Required env vars (fail fast if missing) ──────────────

/**
 * JWT secret for session token signing.
 * Must be set in all environments.
 */
export function getJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error('Missing required env var: JWT_SECRET');
  }
  return value;
}

// ─── Optional env vars (warn + default) ───────────────────

/**
 * SQLite database path. Defaults to `file:./prisma/dev.db`.
 */
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
}

/**
 * Admin password for initial seed. Warns in dev if unset (uses insecure default).
 * Required in production.
 */
export function getAdminPassword(): string | undefined {
  return process.env.ADMIN_PASSWORD;
}

/**
 * Deployment mode: 'bundled' (VPN tools in same container) or 'external' (default).
 */
export function getDeploymentMode(): string {
  return process.env.ACP_DEPLOYMENT_MODE ?? 'external';
}

/**
 * WireGuard network interface name used by service-monitor.
 */
export function getAwgInterface(): string | undefined {
  return process.env.AWG_INTERFACE?.trim() || undefined;
}

/**
 * Base URL for the 3x-ui panel used by service-monitor.
 */
export function getXuiBaseUrl(): string | undefined {
  return process.env.XUI_BASE_URL?.trim() || undefined;
}

/**
 * Cookie value for authenticating with 3x-ui REST API.
 */
export function getXuiCookie(): string | undefined {
  return process.env.XUI_COOKIE;
}

/**
 * Username for authenticating with 3x-ui REST API.
 */
export function getXuiUsername(): string | undefined {
  return process.env.XUI_USERNAME;
}

/**
 * Password for authenticating with 3x-ui REST API.
 */
export function getXuiPassword(): string | undefined {
  return process.env.XUI_PASSWORD;
}

/**
 * Hours window for traffic stats aggregation. Defaults to 24.
 */
export function getTrafficStatsWindowHours(): number {
  const parsed = Number.parseInt(
    process.env.TRAFFIC_STATS_WINDOW_HOURS ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

/**
 * Days to retain traffic logs before cleanup. Defaults to 90.
 */
export function getRetentionDays(): number {
  const parsed = Number.parseInt(process.env.RETENTION_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

/**
 * Days to retain alert records before cleanup. Defaults to 30.
 */
export function getAlertRetentionDays(): number {
  const parsed = Number.parseInt(process.env.ALERT_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

// ─── Startup validation ────────────────────────────────────

interface EnvVarSpec {
  name: string;
  required: boolean;
  description: string;
}

/** All env vars this application uses. */
const ENV_VARS: EnvVarSpec[] = [
  { name: 'JWT_SECRET', required: true, description: 'JWT signing secret' },
  {
    name: 'DATABASE_URL',
    required: false,
    description: 'SQLite database file path',
  },
  {
    name: 'ADMIN_PASSWORD',
    required: false,
    description: 'Initial admin password (required in production)',
  },
  {
    name: 'ACP_DEPLOYMENT_MODE',
    required: false,
    description: 'Deployment mode: bundled | external',
  },
  {
    name: 'AWG_INTERFACE',
    required: false,
    description: 'WireGuard interface name',
  },
  {
    name: 'XUI_BASE_URL',
    required: false,
    description: '3x-ui panel base URL',
  },
  {
    name: 'XUI_COOKIE',
    required: false,
    description: '3x-ui auth cookie',
  },
  {
    name: 'XUI_USERNAME',
    required: false,
    description: '3x-ui REST API username',
  },
  {
    name: 'XUI_PASSWORD',
    required: false,
    description: '3x-ui REST API password',
  },
  {
    name: 'TRAFFIC_STATS_WINDOW_HOURS',
    required: false,
    description: 'Traffic stats window in hours (default: 24)',
  },
  {
    name: 'RETENTION_DAYS',
    required: false,
    description: 'Traffic log retention days (default: 90)',
  },
  {
    name: 'ALERT_RETENTION_DAYS',
    required: false,
    description: 'Alert retention days (default: 30)',
  },
];

/**
 * Validate all required environment variables at startup.
 * Throws if any required var is missing. Logs warnings for optional vars
 * that are unset but may be needed in production.
 */
export function validateEnvironment(): void {
  const missing: string[] = [];
  const missingOptionalProduction: string[] = [];

  for (const spec of ENV_VARS) {
    const value = process.env[spec.name];
    if (!value) {
      if (spec.required) {
        missing.push(spec.name);
      } else if (
        process.env.NODE_ENV === 'production' &&
        spec.name === 'ADMIN_PASSWORD'
      ) {
        missingOptionalProduction.push(spec.name);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
        `Set these before starting the application.`,
    );
  }

  for (const name of missingOptionalProduction) {
    console.warn(
      `[env] Warning: ${name} is not set. This may cause issues in production.`,
    );
  }
}
