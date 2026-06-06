import { execFileSync } from 'child_process';

export interface ServiceHealth {
  service: string;
  systemdName: string;
  status: 'online' | 'offline';
  timestamp: string;
}

export type ServiceKey = 'awg' | '3x-ui';

const SERVICE_MAP: Record<ServiceKey, string> = {
  awg: 'amnezia-awg',
  '3x-ui': '3x-ui',
};

/**
 * Check the current status of a single VPN service via systemctl.
 * Returns 'online' if the service is active, 'offline' otherwise.
 */
export function checkServiceStatus(serviceKey: ServiceKey): ServiceHealth {
  const systemdName = SERVICE_MAP[serviceKey];

  try {
    const result = execFileSync('systemctl', ['is-active', systemdName], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    return {
      service: serviceKey,
      systemdName,
      status: result === 'active' ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      service: serviceKey,
      systemdName,
      status: 'offline',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Check the status of all VPN services.
 */
export function checkAllServices(): ServiceHealth[] {
  const services: ServiceKey[] = ['awg', '3x-ui'];
  return services.map(checkServiceStatus);
}

/**
 * Attempt to restart a VPN service via systemctl.
 * Returns true if the restart command succeeded, false otherwise.
 */
export function restartService(serviceKey: ServiceKey): boolean {
  const systemdName = SERVICE_MAP[serviceKey];

  try {
    execFileSync('systemctl', ['restart', systemdName], {
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * ServiceMonitor provides periodic health checking with auto-restart capability.
 * Intended to be used server-side (e.g., in an API route or cron-like scheduler).
 */
export class ServiceMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private services: ServiceKey[];
  private checkIntervalMs: number;
  private autoRestart: boolean;
  private onStatusChange: (health: ServiceHealth) => void | Promise<void>;

  constructor(options: {
    services?: ServiceKey[];
    checkIntervalMs?: number;
    autoRestart?: boolean;
    onStatusChange: (health: ServiceHealth) => void | Promise<void>;
  }) {
    this.services = options.services ?? ['awg', '3x-ui'];
    this.checkIntervalMs = options.checkIntervalMs ?? 30000;
    this.autoRestart = options.autoRestart ?? true;
    this.onStatusChange = options.onStatusChange;
  }

  /**
   * Start periodic monitoring. Stores last-known statuses to detect transitions.
   */
  start(): void {
    if (this.intervalId !== null) return;

    const lastStatuses: Record<string, 'online' | 'offline'> = {};

    const check = async () => {
      for (const serviceKey of this.services) {
        const health = checkServiceStatus(serviceKey);
        const previous = lastStatuses[serviceKey];

        // Detect transition from online -> offline
        if (previous === 'online' && health.status === 'offline') {
          if (this.autoRestart) {
            const restarted = restartService(serviceKey);
            if (restarted) {
              // Re-check after restart
              const newHealth = checkServiceStatus(serviceKey);
              if (newHealth.status === 'online') {
                health.status = 'online';
              }
            }
          }
          await this.onStatusChange(health);
        }

        lastStatuses[serviceKey] = health.status;
      }
    };

    check().catch(() => {
      /* swallow — check() logs its own errors internally */
    });
    this.intervalId = setInterval(() => {
      check().catch(() => {
        /* swallow — prevents unhandled promise rejection from setInterval */
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop periodic monitoring.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
