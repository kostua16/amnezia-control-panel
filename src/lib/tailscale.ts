import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  TailscaleStatus,
  TailscalePeer,
  TailscaleNodeInfo,
  TransportAddress,
} from '@/types/tailscale';

const execFileAsync = promisify(execFile);

// ─── Constants ───────────────────────────────────────────

/** CLI binary path -- D-04: try PATH first, fallback to /usr/bin/tailscale */
const TAILSCALE_BIN = 'tailscale';
const TAILSCALE_FALLBACK = '/usr/bin/tailscale';

const DEFAULT_TIMEOUT = 10_000;

// ─── Types ───────────────────────────────────────────────

interface CliResult {
  success: boolean;
  stdout: string;
  message: string;
}

// ─── Internal Helpers ────────────────────────────────────

/**
 * Execute a tailscale CLI command.
 *
 * Tries TAILSCALE_BIN first, then TAILSCALE_FALLBACK if ENOENT.
 * Never throws -- always returns a structured CliResult.
 * Uses execFile (array args) to prevent shell injection by design (T-11.1-01).
 */
async function runTailscale(
  args: string[],
  label: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<CliResult> {
  let bin = TAILSCALE_BIN;

  try {
    console.log(`[tailscale] Executing ${label}: ${bin} ${args.join(' ')}`);

    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout,
      encoding: 'utf-8',
    });

    console.log(`[tailscale] ${label} stdout: ${stdout?.trim()}`);
    if (stderr?.trim()) {
      console.warn(`[tailscale] ${label} stderr: ${stderr.trim()}`);
    }

    return { success: true, stdout: stdout ?? '', message: stdout?.trim() ?? 'OK' };
  } catch (err: unknown) {
    // D-04: fallback to /usr/bin/tailscale on ENOENT
    const isEnoent =
      err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (isEnoent && bin === TAILSCALE_BIN) {
      bin = TAILSCALE_FALLBACK;
      try {
        console.log(`[tailscale] Retrying ${label} with fallback: ${bin} ${args.join(' ')}`);

        const { stdout, stderr } = await execFileAsync(bin, args, {
          timeout,
          encoding: 'utf-8',
        });

        console.log(`[tailscale] ${label} stdout: ${stdout?.trim()}`);
        if (stderr?.trim()) {
          console.warn(`[tailscale] ${label} stderr: ${stderr.trim()}`);
        }

        return { success: true, stdout: stdout ?? '', message: stdout?.trim() ?? 'OK' };
      } catch (fallbackErr: unknown) {
        const errMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error(`[tailscale] ${label} failed (fallback): ${errMsg}`);
        return { success: false, stdout: '', message: errMsg };
      }
    }

    const errMsg =
      err instanceof Error
        ? (err as NodeJS.ErrnoException).message ?? String(err)
        : String(err);

    console.error(`[tailscale] ${label} failed: ${errMsg}`);
    return { success: false, stdout: '', message: errMsg };
  }
}

/**
 * Convert a TailscalePeer to a normalized TailscaleNodeInfo.
 * Strips PublicKey per T-11.1-02 (information disclosure mitigation).
 */
function toNodeInfo(peer: TailscalePeer, isSelf: boolean): TailscaleNodeInfo {
  return {
    id: peer.ID,
    hostname: peer.HostName,
    dnsName: peer.DNSName,
    os: peer.OS,
    tailscaleIPs: peer.TailscaleIPs ?? [],
    online: peer.Online,
    relay: peer.Relay ?? '',
    primaryRoutes: peer.PrimaryRoutes ?? [],
    isSelf,
  };
}

// ─── Exported Functions ──────────────────────────────────

/**
 * Check if tailscale is installed and get its version.
 */
export async function verifyInstalled(): Promise<{
  installed: boolean;
  version: string;
}> {
  const result = await runTailscale(['version'], 'verifyInstalled');

  if (!result.success) {
    return { installed: false, version: '' };
  }

  // Parse first line as version string
  const version = result.stdout.trim().split('\n')[0]?.trim() ?? '';
  return { installed: true, version };
}

/**
 * Get raw tailscale status as parsed JSON.
 * Returns null on failure (non-throwing pattern).
 */
export async function getStatus(): Promise<TailscaleStatus | null> {
  const result = await runTailscale(['status', '--json'], 'getStatus');

  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as TailscaleStatus;
  } catch {
    console.error('[tailscale] getStatus: failed to parse JSON output');
    return null;
  }
}

/**
 * Get all nodes in the tailnet (self + peers) as normalized TailscaleNodeInfo[].
 */
export async function getNodes(): Promise<TailscaleNodeInfo[]> {
  const status = await getStatus();

  if (!status) {
    return [];
  }

  const nodes: TailscaleNodeInfo[] = [];

  // Prepend self node
  nodes.push(toNodeInfo(status.Self, true));

  // Add all peers
  for (const peer of Object.values(status.Peer)) {
    nodes.push(toNodeInfo(peer, false));
  }

  return nodes;
}

/**
 * Get the Tailscale IPv4 address of the local node or a specific node.
 * If no hostname is provided, returns the local node's IP.
 */
export async function getNodeIP(hostname?: string): Promise<string | null> {
  const args = hostname ? ['ip', '-4', hostname] : ['ip', '-4'];
  const result = await runTailscale(args, `getNodeIP(${hostname ?? 'self'})`);

  if (!result.success) {
    return null;
  }

  const ip = result.stdout.trim();
  return ip || null;
}

/**
 * Check if a specific peer node is reachable (online).
 * Matches by HostName or DNSName.
 */
export async function isReachable(hostname: string): Promise<boolean> {
  const status = await getStatus();

  if (!status) {
    return false;
  }

  // Check self
  if (
    status.Self.HostName === hostname ||
    status.Self.DNSName === hostname
  ) {
    return status.Self.Online;
  }

  // Check peers
  for (const peer of Object.values(status.Peer)) {
    if (peer.HostName === hostname || peer.DNSName === hostname) {
      return peer.Online;
    }
  }

  return false;
}

/** CIDR validation regex for advertiseRoutes. */
const CIDR_REGEX = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/;

/**
 * Advertise subnet routes via tailscale.
 * Validates each CIDR before calling the CLI (T-11.1-01 mitigation).
 */
export async function advertiseRoutes(
  subnets: string[],
): Promise<{ success: boolean; message: string }> {
  // Validate all CIDRs first
  const invalid = subnets.filter((s) => !CIDR_REGEX.test(s));

  if (invalid.length > 0) {
    return {
      success: false,
      message: `Invalid CIDR format: ${invalid.join(', ')}`,
    };
  }

  if (subnets.length === 0) {
    return { success: false, message: 'No subnets provided' };
  }

  const cidrs = subnets.join(',');
  return runTailscale(
    ['set', `--advertise-routes=${cidrs}`],
    `advertiseRoutes(${cidrs})`,
  );
}

/**
 * Get the Tailscale backend state (e.g. "Running", "NeedsLogin", "Stopped").
 * Returns "Unknown" if status is unavailable.
 */
export async function getBackendState(): Promise<string> {
  const status = await getStatus();
  return status?.BackendState ?? 'Unknown';
}

/**
 * Resolve the transport address for a remote panel node.
 * Uses the first TailscaleIP of the node with a default port.
 */
export async function resolveTransportAddress(
  hostname: string,
  defaultPort = 443,
): Promise<TransportAddress | null> {
  const ip = await getNodeIP(hostname);

  if (!ip) {
    return null;
  }

  return {
    tailscaleIP: ip,
    hostname,
    port: defaultPort,
  };
}
