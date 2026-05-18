import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generatePerPanelConfig } from '@/lib/panel-sync-client';
import { computeConfigDiff } from '@/lib/config-diff';
import type { ChainConfig } from '@/types/chain';

// ─── Request Validation ─────────────────────────────────

const diffRequestSchema = z.object({
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
});

// ─── POST /api/panels/diff ─────────────────────────────

/**
 * Preview config diff between current cached config and incoming chain config.
 * Returns per-panel structured diff results with sections and formatted configs.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = diffRequestSchema.safeParse(body);

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

    const { chainConfig } = parsed.data;

    // Fetch all active panels
    const panels = await prisma.remotePanel.findMany({
      where: { isActive: true },
    });

    const diffs = [];

    for (const panel of panels) {
      const panelConfig = generatePerPanelConfig(chainConfig, panel.id);

      if (!panelConfig) {
        // Panel has no role in this chain — skip
        continue;
      }

      const diff = await computeConfigDiff(panel.id, panel.name, panelConfig);
      diffs.push(diff);
    }

    return NextResponse.json({ success: true, data: { diffs } });
  } catch (err) {
    console.error('[api/panels/diff] Diff computation failed:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Diff computation failed',
      },
      { status: 500 },
    );
  }
}
