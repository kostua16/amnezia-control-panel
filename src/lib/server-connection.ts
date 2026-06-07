import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  Server,
  ServerConnectionStatus,
  ServerTestResult,
} from '@/types/server';

const execFileAsync = promisify(execFile);

// ─── Hostname Validation ─────────────────────────────────

/** Reject hostnames that could allow command injection via shell metacharacters. */
const SAFE_HOSTNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  return SAFE_HOSTNAME_RE.test(hostname);
}

// ─── Connection Pool ──────────────────────────────────────

interface ConnectionPoolEntry {
  lastUsed: number;
  status: ServerConnectionStatus;
  latencyMs: number | null;
}

const connectionPool = new Map<number, ConnectionPoolEntry>();

const POOL_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getPoolEntry(serverId: number): ConnectionPoolEntry | undefined {
  const entry = connectionPool.get(serverId);
  if (!entry) return undefined;
  if (Date.now() - entry.lastUsed > POOL_TTL_MS) {
    connectionPool.delete(serverId);
    return undefined;
  }
  return entry;
}

function setPoolEntry(
  serverId: number,
  status: ServerConnectionStatus,
  latencyMs: number | null,
): void {
  connectionPool.set(serverId, { lastUsed: Date.now(), status, latencyMs });
}

// ─── Test Connection ──────────────────────────────────────

/**
 * Test SSH connectivity to a server.
 * Uses a simple TCP check via a short-lived SSH connection attempt.
 *
 * NOTE: Currently stubs the actual SSH test. In production this would
 * use the SSH2 library or a simple TCP probe to verify reachability.
 */
export async function testConnection(
  server: Server,
): Promise<ServerTestResult> {
  // Check pool first
  const cached = getPoolEntry(server.id);
  if (cached) {
    return {
      success: cached.status === 'connected',
      latencyMs: cached.latencyMs,
      message:
        cached.status === 'connected'
          ? 'Connected (cached)'
          : 'Server offline (cached)',
      timestamp: new Date().toISOString(),
    };
  }

  const startTime = Date.now();

  try {
    // Sanitize hostname to prevent command injection
    if (!isValidHostname(server.hostname)) {
      return {
        success: false,
        latencyMs: null,
        message: `Invalid hostname: ${server.hostname}`,
        timestamp: new Date().toISOString(),
      };
    }

    // Use ping as a basic reachability check (cross-platform stub).
    // In production, replace with a proper SSH/TCP connection test.
    const isWindows = process.platform === 'win32';
    const pingArgs = isWindows
      ? ['-n', '1', '-w', '3000', server.hostname]
      : ['-c', '1', '-W', '3', server.hostname];

    await execFileAsync('ping', pingArgs, { timeout: 5000 });
    const latencyMs = Date.now() - startTime;

    setPoolEntry(server.id, 'connected', latencyMs);

    return {
      success: true,
      latencyMs,
      message: `Server reachable (${latencyMs}ms)`,
      timestamp: new Date().toISOString(),
    };
  } catch {
    setPoolEntry(server.id, 'offline', null);

    return {
      success: false,
      latencyMs: null,
      message: `Cannot reach ${server.hostname}:${server.port}`,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Execute Remote Command ───────────────────────────────

export interface RemoteCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Execute a command on a remote server via SSH.
 *
 * NOTE: Currently a stub. In production, use the SSH2 library or
 * a similar SSH client to execute commands on the remote server.
 */
export async function executeOnServer(
  server: Server,
  command: string,
): Promise<RemoteCommandResult> {
  // Verify server is reachable first
  const connResult = await testConnection(server);
  if (!connResult.success) {
    return {
      success: false,
      stdout: '',
      stderr: `Server ${server.hostname}:${server.port} is not reachable`,
      exitCode: null,
    };
  }

  try {
    // STUB: In production, execute via SSH2 or similar.
    // This simulates running a command on the remote server.
    console.log(
      `[server-connection] Would execute on ${server.hostname}:${server.port}: ${command}`,
    );

    return {
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      stdout: '',
      stderr: message,
      exitCode: 1,
    };
  }
}

// ─── Pool Management ──────────────────────────────────────

/**
 * Clear stale entries from the connection pool.
 * Call periodically or before operations that need fresh status.
 */
export function clearStaleConnections(): void {
  const now = Date.now();
  for (const [id, entry] of connectionPool) {
    if (now - entry.lastUsed > POOL_TTL_MS) {
      connectionPool.delete(id);
    }
  }
}

/**
 * Get the cached connection status for a server, if available.
 */
export function getCachedStatus(
  serverId: number,
): ServerConnectionStatus | null {
  const entry = getPoolEntry(serverId);
  return entry?.status ?? null;
}

/**
 * Invalidate a specific server's cached connection status.
 */
export function invalidateConnection(serverId: number): void {
  connectionPool.delete(serverId);
}
