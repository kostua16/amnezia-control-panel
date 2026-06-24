import { readFile } from 'node:fs/promises';

import { execCommand } from '@/lib/command-executor';
import { isBundledDeployment } from '@/lib/deployment-mode';

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

const BUNDLED_RESTART_SCRIPT: Record<ServiceKey, string> = {
  awg: '/docker/stack/scripts/restart-awg.sh',
  '3x-ui': '/docker/stack/scripts/restart-xui.sh',
};

function awgInterface(): string {
  const value = process.env.AWG_INTERFACE?.trim();
  return value || 'awg0';
}

function xuiBaseUrl(): string {
  const value = process.env.XUI_BASE_URL?.trim();
  return value || 'http://127.0.0.1:2053';
}

async function checkBundledAwgStatus(): Promise<ServiceHealth> {
  const systemdName = SERVICE_MAP.awg;
  const iface = awgInterface();

  try {
    const operstate = await readFile(
      `/sys/class/net/${iface}/operstate`,
      'utf-8',
    );
    const online = operstate.trim() === 'unknown' || operstate.trim() === 'up';
    return {
      service: 'awg',
      systemdName,
      status: online ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      `[service-monitor] Bundled AWG check failed for ${iface}:`,
      err,
    );
    return {
      service: 'awg',
      systemdName,
      status: 'offline',
      timestamp: new Date().toISOString(),
    };
  }
}

async function checkBundledXuiStatus(): Promise<ServiceHealth> {
  const systemdName = SERVICE_MAP['3x-ui'];
  const baseUrl = xuiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const online = response.ok || response.status === 404;
    return {
      service: '3x-ui',
      systemdName,
      status: online ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[service-monitor] Bundled 3x-ui HTTP check failed:', err);
    return {
      service: '3x-ui',
      systemdName,
      status: 'offline',
      timestamp: new Date().toISOString(),
    };
  }
}

async function checkExternalServiceStatus(
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
 * Check the current status of a single VPN service.
 * External mode uses systemctl; bundled mode probes local CLIs/HTTP.
 */
export async function checkServiceStatus(
  serviceKey: ServiceKey,
): Promise<ServiceHealth> {
  if (isBundledDeployment()) {
    return serviceKey === 'awg'
      ? checkBundledAwgStatus()
      : checkBundledXuiStatus();
  }
  return checkExternalServiceStatus(serviceKey);
}

/**
 * Check the status of all VPN services.
 */
export async function checkAllServices(): Promise<ServiceHealth[]> {
  const services: ServiceKey[] = ['awg', '3x-ui'];
  return Promise.all(services.map(checkServiceStatus));
}

async function restartBundledService(serviceKey: ServiceKey): Promise<boolean> {
  const script = BUNDLED_RESTART_SCRIPT[serviceKey];
  try {
    await execCommand('sudo', ['-n', script], { timeoutMs: 15000 });
    return true;
  } catch (err) {
    console.error(
      `[service-monitor] Bundled restart failed for ${serviceKey}:`,
      err,
    );
    return false;
  }
}

/**
 * Attempt to restart a VPN service.
 * External mode uses systemctl; bundled mode uses stack helper scripts.
 */
export async function restartService(serviceKey: ServiceKey): Promise<boolean> {
  if (isBundledDeployment()) {
    return restartBundledService(serviceKey);
  }

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
          await this.onStatusChange(health);
        } else if (previous === 'online' && health.status === 'offline') {
          if (this.autoRestart) {
            const restarted = await restartService(serviceKey);
            if (restarted) {
              const newHealth = await checkServiceStatus(serviceKey);
              if (newHealth.status === 'online') {
                health.status = 'online';
              }
            }
          }
          await this.onStatusChange(health);
        } else if (previous !== health.status) {
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
