import os from 'os';
import { execCommand, type ExecResult } from '@/lib/command-executor';
import type { SystemResources } from '@/types/monitoring';

type ExecFn = (
  cmd: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<ExecResult>;

const defaultExec: ExecFn = (cmd, args, options) =>
  execCommand(cmd, args, options);
let runExec = defaultExec;

interface CachedResources {
  data: SystemResources;
  expiresAt: number;
}

let cachedResources: CachedResources | null = null;
let inflightResources: Promise<SystemResources> | null = null;
const CACHE_TTL_MS = 10_000;

interface DiskUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

/**
 * Get CPU usage as a percentage (0-100).
 * Computed by sampling two snapshots 100ms apart.
 */
async function getCpuUsage(): Promise<number> {
  const sample1 = getAverageLoad();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const sample2 = getAverageLoad();

  const idleDiff = sample2.idle - sample1.idle;
  const totalDiff = sample2.total - sample1.total;

  if (totalDiff === 0) return 0;
  return Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100));
}

function getAverageLoad(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.idle + t.user + t.nice + t.sys + t.irq;
  }
  return { idle, total };
}

/**
 * Get disk usage for the filesystem containing the project root.
 * Falls back to '/' on non-Windows, or the drive root on Windows.
 *
 * Non-blocking: shells out via execFile (promisified) instead of the
 * synchronous execFileSync so a slow df/PowerShell call cannot stall the
 * event loop between broadcaster ticks.
 */
async function getDiskUsageAsync(): Promise<DiskUsage> {
  try {
    const isWin = process.platform === 'win32';

    if (isWin) {
      // PowerShell CIM query — wmic is deprecated on modern Windows.
      const { stdout } = await runExec(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" | Select-Object Size,FreeSpace | ConvertTo-Json',
        ],
        { timeoutMs: 5000 },
      );

      const disk = JSON.parse(stdout.trim());
      const total = Number(disk.Size) || 0;
      const free = Number(disk.FreeSpace) || 0;
      const used = total - free;
      const percent = total > 0 ? Math.round((used / total) * 100) : 0;
      return { total, used, free, percent };
    }

    // Unix: use df
    const { stdout } = await runExec('df', ['-k', '/'], {
      timeoutMs: 5000,
    });
    const output = stdout.trim();

    // Parse df output: skip header, second line has the data
    const lines = output.split('\n');
    const parts = lines[1]?.split(/\s+/);
    if (!parts || parts.length < 4) {
      return { total: 0, used: 0, free: 0, percent: 0 };
    }

    const totalKb = parseInt(parts[1], 10);
    const usedKb = parseInt(parts[2], 10);
    const freeKb = parseInt(parts[3], 10);
    const percent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;

    return {
      total: totalKb * 1024,
      used: usedKb * 1024,
      free: freeKb * 1024,
      percent,
    };
  } catch (err) {
    console.error('[resource-monitor] Failed to read disk usage:', err);
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

async function computeSystemResources(): Promise<SystemResources> {
  const now = Date.now();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const disk = await getDiskUsageAsync();

  const data: SystemResources = {
    cpu: {
      usage: await getCpuUsage(),
      cores: os.cpus().length,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
    },
    disk,
    timestamp: new Date().toISOString(),
  };

  cachedResources = {
    data,
    expiresAt: now + CACHE_TTL_MS,
  };

  return data;
}

/**
 * Collect system resources (CPU, RAM, Disk).
 * Results are cached for 10 seconds.
 */
export async function getSystemResources(): Promise<SystemResources> {
  if (cachedResources && cachedResources.expiresAt > Date.now()) {
    return cachedResources.data;
  }

  if (inflightResources) {
    return inflightResources;
  }

  inflightResources = computeSystemResources().finally(() => {
    inflightResources = null;
  });

  return inflightResources;
}

export function __setResourceMonitorDepsForTests(deps: {
  execCommand?: ExecFn;
}): void {
  if (deps.execCommand) {
    runExec = deps.execCommand;
  }
}

export function __resetResourceMonitorForTests(): void {
  cachedResources = null;
  inflightResources = null;
  runExec = defaultExec;
}
