import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  verifyInstalled,
  getStatus,
  getBackendState,
  getNodes,
} from '@/lib/tailscale';
import { isBundledDeployment } from '@/lib/deployment-mode';

const execFileAsync = promisify(execFile);

// ─── Schema ─────────────────────────────────────────────

const verifySchema = z.object({
  step: z.enum([
    'install',
    'auth',
    'ip-forwarding',
    'subnet-config',
    'tailnet-check',
  ]),
  subnets: z.array(z.string()).optional(),
});

// ─── CIDR helpers ───────────────────────────────────────

const CIDR_REGEX =
  /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/;

/** Default subnets per D-05: AmneziaWG (10.0.0.0/24) and Xray (172.16.0.0/12). */
const DEFAULT_SUBNETS = ['10.0.0.0/24', '172.16.0.0/12'];

/**
 * Check for overlapping CIDR ranges.
 * Compares each pair of subnets; returns warnings for overlaps (D-06: warn but don't block).
 */
function findOverlappingSubnets(subnets: string[]): string[] {
  const warnings: string[] = [];

  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      if (cidrsOverlap(subnets[i], subnets[j])) {
        warnings.push(`"${subnets[i]}" and "${subnets[j]}" may overlap`);
      }
    }
  }

  return warnings;
}

/**
 * Simple CIDR overlap detection: convert to 32-bit integer ranges and check intersection.
 * This is a conservative check -- it may flag some non-overlapping but proximate ranges,
 * which is acceptable for a warning-only check (D-06).
 */
function cidrsOverlap(a: string, b: string): boolean {
  const rangeA = cidrToRange(a);
  const rangeB = cidrToRange(b);
  if (!rangeA || !rangeB) return false;
  return rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1];
}

function cidrToRange(cidr: string): [number, number] | null {
  const match = cidr.match(CIDR_REGEX);
  if (!match) return null;

  const [ipStr, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr ?? '0', 10);
  const octets = ipStr!.split('.').map(Number);

  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null;
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const ip =
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
    0;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;

  return [network, broadcast];
}

// ─── POST handler ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { step, subnets } = parsed.data;
    const result = await runStep(step, subnets);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/tailscale/setup/verify] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Setup verification failed' },
      { status: 500 },
    );
  }
}

// ─── Step dispatch ─────────────────────────────────────

async function runStep(
  step: string,
  subnets?: string[],
): Promise<Record<string, unknown>> {
  switch (step) {
    case 'install':
      return verifyInstallStep();
    case 'auth':
      return verifyAuthStep();
    case 'ip-forwarding':
      return verifyIpForwardingStep();
    case 'subnet-config':
      return verifySubnetConfigStep(subnets);
    case 'tailnet-check':
      return verifyTailnetCheckStep();
    default:
      return {
        step,
        passed: false,
        message: `Unknown step: ${step}`,
      };
  }
}

// ─── Step 1: install ───────────────────────────────────

async function verifyInstallStep() {
  const { installed, version } = await verifyInstalled();

  return {
    step: 'install',
    passed: installed,
    installed,
    version,
    message: installed
      ? `Tailscale ${version} installed`
      : 'Tailscale is not installed. Install from https://tailscale.com/download',
  };
}

// ─── Step 2: auth ──────────────────────────────────────

async function verifyAuthStep() {
  const state = await getBackendState();

  switch (state) {
    case 'Running':
      return {
        step: 'auth',
        passed: true,
        state,
        message: 'Tailscale is connected and authenticated',
      };
    case 'NeedsLogin':
      return {
        step: 'auth',
        passed: false,
        state,
        message: 'Tailscale installed but not logged in. Run: tailscale login',
      };
    case 'Stopped':
      return {
        step: 'auth',
        passed: false,
        state,
        message: isBundledDeployment()
          ? 'Tailscale daemon is not running. Restart the tailscaled s6 service or recreate the stack container.'
          : 'Tailscale daemon is not running. Start with: sudo systemctl start tailscaled',
      };
    default:
      return {
        step: 'auth',
        passed: false,
        state,
        message: `Tailscale backend state: ${state}`,
      };
  }
}

// ─── Step 3: ip-forwarding ─────────────────────────────

async function verifyIpForwardingStep() {
  try {
    const { stdout } = await execFileAsync('sysctl', ['net.ipv4.ip_forward'], {
      timeout: 5_000,
      encoding: 'utf-8',
    });

    const enabled = stdout.includes('= 1');

    return {
      step: 'ip-forwarding',
      passed: enabled,
      message: enabled
        ? 'IP forwarding is enabled'
        : 'IP forwarding is disabled. Enable with: sudo sysctl -w net.ipv4.ip_forward=1',
    };
  } catch {
    return {
      step: 'ip-forwarding',
      passed: false,
      message:
        'Could not check IP forwarding. Ensure sysctl is available. Enable with: sudo sysctl -w net.ipv4.ip_forward=1',
    };
  }
}

// ─── Step 4: subnet-config ─────────────────────────────

async function verifySubnetConfigStep(subnets?: string[]) {
  // D-05: auto-detect defaults if none provided
  const resolved = subnets && subnets.length > 0 ? subnets : DEFAULT_SUBNETS;

  // Validate CIDR format
  const invalid = resolved.filter((s) => !CIDR_REGEX.test(s));

  if (invalid.length > 0) {
    return {
      step: 'subnet-config',
      passed: false,
      subnets: resolved,
      message: `Invalid CIDR format: ${invalid.join(', ')}`,
    };
  }

  // D-06: check for overlapping subnets
  const warnings = findOverlappingSubnets(resolved);

  return {
    step: 'subnet-config',
    passed: true,
    subnets: resolved,
    warnings: warnings.length > 0 ? warnings : undefined,
    message:
      warnings.length > 0
        ? `${resolved.length} subnet(s) configured with ${warnings.length} overlap warning(s)`
        : `${resolved.length} subnet(s) configured`,
  };
}

// ─── Step 5: tailnet-check ─────────────────────────────

async function verifyTailnetCheckStep() {
  const status = await getStatus();

  if (!status) {
    return {
      step: 'tailnet-check',
      passed: false,
      message: 'Could not retrieve Tailscale status',
    };
  }

  const selfIPs = status.Self?.TailscaleIPs ?? [];
  const nodes = await getNodes();

  return {
    step: 'tailnet-check',
    passed: selfIPs.length > 0,
    nodeIP: selfIPs[0] ?? null,
    nodeHostname: status.Self?.HostName ?? null,
    peerCount: nodes.length - 1, // exclude self
    message:
      selfIPs.length > 0
        ? `Node is visible in tailnet with ${nodes.length - 1} peer(s)`
        : 'Node is not visible in tailnet -- no Tailscale IP assigned',
  };
}
