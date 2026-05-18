import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { pushConfigToAllPanels } from '@/lib/panel-sync-client';
import { cachePanelApiKey } from '@/lib/panel-health-checker';

// ─── Request Validation ─────────────────────────────────

const pushRequestSchema = z.object({
  chainConfig: z.object({
    templateId: z.string().min(1),
    nodes: z.array(
      z.object({
        label: z.string(),
        serverId: z.number().int(),
        role: z.enum(['entry', 'middle', 'exit', 'domestic', 'foreign']),
        protocol: z.enum(['wireguard', 'xray']),
        hostname: z.string(),
        port: z.number().int(),
      }),
    ),
    wireguardPeers: z.array(
      z.object({
        nodeId: z.string(),
        publicKey: z.string(),
        allowedIPs: z.string(),
        endpoint: z.string(),
        persistentKeepalive: z.number().int().optional(),
      }),
    ),
    xrayRoutingRules: z.array(
      z.object({
        nodeId: z.string(),
        type: z.enum(['ip', 'domain', 'geoip']),
        value: z.string(),
        outboundTag: z.string(),
        priority: z.number().int(),
      }),
    ),
    generatedAt: z.string().min(1),
  }),
  /** Plaintext API keys for each panel: { panelId: apiKey } */
  panelApiKeys: z.record(z.coerce.number().int(), z.string()),
});

// ─── POST /api/panels/push ─────────────────────────────

/**
 * Trigger a config push from central panel to all active remote panels.
 * Accepts chainConfig + panelApiKeys, caches keys for auto-resync,
 * and calls pushConfigToAllPanels.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = pushRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { chainConfig, panelApiKeys } = parsed.data;

    // Cache API keys in memory for future auto-resync (never persisted to DB)
    for (const [panelId, apiKey] of Object.entries(panelApiKeys)) {
      cachePanelApiKey(Number(panelId), apiKey);
    }

    // Convert to Map for pushConfigToAllPanels
    const panelApiKeysMap = new Map<number, string>(
      Object.entries(panelApiKeys).map(([id, key]) => [Number(id), key]),
    );

    const pushAllResult = await pushConfigToAllPanels(
      chainConfig,
      panelApiKeysMap,
    );

    return NextResponse.json({ success: true, data: pushAllResult });
  } catch (err) {
    console.error('[api/panels/push] Push failed:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Push failed',
      },
      { status: 500 },
    );
  }
}
