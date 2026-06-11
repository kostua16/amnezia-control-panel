import os from 'os';
import { execFileSync } from 'child_process';
import type { SystemResources } from '@/types/monitoring';

interface CachedResources {
  data: SystemResources;
  expiresAt: number;
}

let cachedResources: CachedResources | null = null;
const CACHE_TTL_MS = 10_000;

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
 */
function getDiskUsage(): {
  total: number;
  used: number;
  free: number;
  percent: number;
} {
  try {
    const isWin = process.platform === 'win32';
    const target = isWin ? 'C:' : '/';

    if (isWin) {
      // Use wmic on Windows
      const output = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" | Select-Object Size,FreeSpace | ConvertTo-Json',
        ],
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();

      const disk = JSON.parse(output);
      const total = Number(disk.Size) || 0;
      const free = Number(disk.FreeSpace) || 0;
      const used = total - free;
      const percent = total > 0 ? Math.round((used / total) * 100) : 0;
      return { total, used, free, percent };
    }

    // Unix: use df
    const output = execFileSync('df', ['-k', target], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

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

/**
 * Collect system resources (CPU, RAM, Disk).
 * Results are cached for 10 seconds.
 */
export async function getSystemResources(): Promise<SystemResources> {
  const now = Date.now();

  if (cachedResources && cachedResources.expiresAt > now) {
    return cachedResources.data;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const disk = getDiskUsage();

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
