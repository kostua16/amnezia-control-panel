import { execCommand } from '@/lib/command-executor';

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
 *
 * Async so HTTP handlers (e.g. the service-status route) can await it without
 * blocking the Node event loop while systemctl responds.
 */
export async function checkServiceStatus(
  serviceKey: ServiceKey,
): Promise<ServiceHealth> {
  const systemdName = SERVICE_MAP[serviceKey];

  try {
    const { stdout } = await execCommand(
      'systemctl',
      ['is-active', systemdName],
      {
        encoding: 'utf-8',
        timeoutMs: 5000,
      },
    );

    return {
      service: serviceKey,
      systemdName,
      status: stdout.trim() === 'active' ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      `[service-monitor] Failed to check status of ${systemdName}:`,
      err,
    );
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
export async function checkAllServices(): Promise<ServiceHealth[]> {
  const services: ServiceKey[] = ['awg', '3x-ui'];
  return Promise.all(services.map(checkServiceStatus));
}

/**
 * Attempt to restart a VPN service via systemctl.
 * Returns true if the restart command succeeded, false otherwise.
 */
export async function restartService(serviceKey: ServiceKey): Promise<boolean> {
  const systemdName = SERVICE_MAP[serviceKey];

  try {
    await execCommand('systemctl', ['restart', systemdName], {
      timeoutMs: 15000,
    });
    return true;
  } catch (err) {
    console.error(`[service-monitor] Failed to restart ${systemdName}:`, err);
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
        const health = await checkServiceStatus(serviceKey);
        const previous = lastStatuses[serviceKey];

        if (previous === undefined) {
          // First check: report initial status regardless.
          await this.onStatusChange(health);
        } else if (previous === 'online' && health.status === 'offline') {
          // Detect transition from online -> offline
          if (this.autoRestart) {
            const restarted = await restartService(serviceKey);
            if (restarted) {
              // Re-check after restart
              const newHealth = await checkServiceStatus(serviceKey);
              if (newHealth.status === 'online') {
                health.status = 'online';
              }
            }
          }
          await this.onStatusChange(health);
        } else if (previous !== health.status) {
          // Report any other status change (e.g. offline -> online)
          await this.onStatusChange(health);
        }

        lastStatuses[serviceKey] = health.status;
      }
    };

    check();
    this.intervalId = setInterval(check, this.checkIntervalMs);
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
