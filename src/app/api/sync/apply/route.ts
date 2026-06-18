import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/hmac';
import { writeAuditLog } from '@/lib/audit-log';
import { verifySecret } from '@/lib/crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── Request Schema ────────────────────────────────────────

const syncApplyPayloadSchema = z.object({
  service: z.enum(['awg', 'three_xui']),
  config: z.string().optional(),
  routingRules: z
    .array(
      z.object({
        type: z.enum(['ip', 'domain', 'geoip']),
        value: z.string(),
        outboundTag: z.string(),
        priority: z.number().int(),
      }),
    )
    .optional(),
});

// ─── Helpers ───────────────────────────────────────────────

/**
 * Execute a shell command and return a structured result.
 * Follows the same pattern as vpn-services.ts runCommand.
 */
async function runCommand(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ success: boolean; stdout: string; message: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      encoding: 'utf-8',
    });
    const msg = stdout?.trim() || stderr?.trim() || 'OK';
    return { success: true, stdout: stdout ?? '', message: msg };
  } catch (err) {
    const errMsg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as Error).message)
        : String(err);
    return { success: false, stdout: '', message: errMsg };
  }
}

/**
 * Apply WireGuard configuration via CLI.
 *
 * Uses `wg-quick` or `amneziawg` to apply peer configuration.
 * The config is passed as a file path argument following the execFile
 * array-based argument pattern (no shell injection risk).
 *
 * In production, the exact CLI command depends on the server's Amnezia AWG
 * installation.
 */
async function applyWireguardConfig(
  wgConfig: string,
): Promise<{ success: boolean; message: string }> {
  // Write config to a temporary file, then pass the path to the CLI
  // This avoids shell injection and follows the execFile pattern
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');

  let tmpFile: string | null = null;
  try {
    tmpFile = path.join(os.tmpdir(), `wg-apply-${Date.now()}.conf`);
    await fs.writeFile(tmpFile, wgConfig, 'utf-8');

    // Check if wg-quick is available
    const whichResult = await runCommand('which', ['wg-quick'], 5_000);
    const wgBinary = whichResult.success ? 'wg-quick' : 'amneziawg';

    // Apply config via the CLI, passing the temp file path as an argument
    const result = await runCommand(wgBinary, ['apply-conf', tmpFile], 15_000);

    return {
      success: result.success,
      message: result.success
        ? result.stdout?.trim() || `Config applied via ${wgBinary}`
        : `Failed to apply WireGuard config: ${result.message}`,
    };
  } catch (err) {
    const errMsg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as Error).message)
        : String(err);
    return {
      success: false,
      message: `Failed to apply WireGuard config: ${errMsg}`,
    };
  } finally {
    // Clean up temp file
    if (tmpFile) {
      try {
        await fs.unlink(tmpFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Apply 3x-ui routing rules.
 *
 * Passes rules as a JSON file path to the CLI, following the same
 * safe argument-passing pattern as vpn-services.ts.
 */
async function applyThreeXuiRules(
  routingRules: Array<{
    type: string;
    value: string;
    outboundTag: string;
    priority: number;
  }>,
): Promise<{ success: boolean; message: string }> {
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');

  let tmpFile: string | null = null;
  try {
    // Check if xui CLI is available
    const whichResult = await runCommand('which', ['xui'], 5_000);
    if (!whichResult.success) {
      return {
        success: false,
        message: '3x-ui CLI (xui) not found on this server',
      };
    }

    // Write rules to a temp file and pass path as argument
    tmpFile = path.join(os.tmpdir(), `xui-rules-${Date.now()}.json`);
    await fs.writeFile(tmpFile, JSON.stringify(routingRules), 'utf-8');

    const result = await runCommand('xui', ['apply-rules', tmpFile], 15_000);

    return {
      success: result.success,
      message: result.success
        ? result.stdout?.trim() ||
          `Applied ${routingRules.length} routing rules via 3x-ui`
        : `Failed to apply 3x-ui rules: ${result.message}`,
    };
  } catch (err) {
    const errMsg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as Error).message)
        : String(err);
    return {
      success: false,
      message: `Failed to apply 3x-ui rules: ${errMsg}`,
    };
  } finally {
    if (tmpFile) {
      try {
        await fs.unlink(tmpFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

// ─── POST Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 1. Extract auth headers
    const apiKey = request.headers.get('X-API-Key');
    const signature = request.headers.get('X-Signature');

    if (!apiKey || !signature) {
      return NextResponse.json(
        { success: false, error: 'Missing X-API-Key or X-Signature header' },
        { status: 401 },
      );
    }

    // 2. Auth check: find panel by API key hash
    const panels = await prisma.remotePanel.findMany({
      where: { isActive: true },
    });

    let matchedPanel: (typeof panels)[number] | null = null;

    for (const panel of panels) {
      const isValid = await verifySecret(apiKey, panel.apiKeyHash);
      if (isValid) {
        matchedPanel = panel;
        break;
      }
    }

    if (!matchedPanel) {
      return NextResponse.json(
        { success: false, error: 'Invalid API key' },
        { status: 401 },
      );
    }

    // 3. Parse request body
    const body = await request.json();

    // 4. Zod validation
    const parsed = syncApplyPayloadSchema.safeParse(body);
    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid payload structure';
      return NextResponse.json(
        { success: false, error: `Invalid payload: ${firstError}` },
        { status: 400 },
      );
    }

    const { service } = parsed.data;

    // 5. HMAC signature verification
    if (!verifySignature(body, apiKey, signature)) {
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 },
      );
    }

    // 6. Read the latest cached config for this panel
    const cachedConfig = await prisma.cachedPanelConfig.findUnique({
      where: { panelId: matchedPanel.id },
    });

    if (!cachedConfig) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No cached config found. Config must be received via /api/sync/receive before applying.',
        },
        { status: 400 },
      );
    }

    const configData = cachedConfig.config as Record<string, unknown>;

    // 7. Apply config based on service type
    let applyResult: { success: boolean; message: string };

    if (service === 'awg') {
      // Use the config from the request body if provided, otherwise from cached config
      const wgConfig =
        parsed.data.config ??
        (Array.isArray(configData.wireguardPeers)
          ? configData.wireguardPeers
              .map((peer: Record<string, unknown>) => {
                const lines = ['[Peer]'];
                lines.push(`PublicKey = ${peer.publicKey}`);
                lines.push(`AllowedIPs = ${peer.allowedIPs}`);
                lines.push(`Endpoint = ${peer.endpoint}`);
                if (peer.persistentKeepalive != null) {
                  lines.push(
                    `PersistentKeepalive = ${peer.persistentKeepalive}`,
                  );
                }
                return lines.join('\n');
              })
              .join('\n\n')
          : null);

      if (!wgConfig) {
        return NextResponse.json(
          { success: false, error: 'No WireGuard config available to apply' },
          { status: 400 },
        );
      }

      applyResult = await applyWireguardConfig(wgConfig);
    } else {
      // service === 'three_xui'
      const rules =
        parsed.data.routingRules ??
        (Array.isArray(configData.routingRules)
          ? configData.routingRules
          : null);

      if (!rules || (Array.isArray(rules) && rules.length === 0)) {
        return NextResponse.json(
          { success: false, error: 'No routing rules available to apply' },
          { status: 400 },
        );
      }

      applyResult = await applyThreeXuiRules(rules);
    }

    // 8. Return result
    await writeAuditLog({
      action: 'sync.apply',
      resource: 'cachedPanelConfig',
      resourceId: matchedPanel.id,
      outcome: applyResult.success ? 'success' : 'failure',
      metadata: {
        panelId: matchedPanel.id,
        service,
        configVersion: cachedConfig.configVersion,
        message: applyResult.message,
      },
    });

    if (applyResult.success) {
      return NextResponse.json({
        success: true,
        data: {
          applied: true,
          configVersion: cachedConfig.configVersion,
          service,
          message: applyResult.message,
        },
      });
    }

    return NextResponse.json({
      success: false,
      data: {
        applied: false,
        configVersion: cachedConfig.configVersion,
        service,
        error: applyResult.message,
      },
    });
  } catch (err) {
    console.error('[api/sync/apply] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to apply config' },
      { status: 500 },
    );
  }
}
