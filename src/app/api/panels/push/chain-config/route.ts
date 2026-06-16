import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTemplateById } from '@/lib/chain-templates';
import { prisma } from '@/lib/prisma';
import { resolvePanelTransport } from '@/lib/transport-resolver';
import { writeAuditLog } from '@/lib/audit-log';
import {
  generateWireGuardPeers,
  generateXrayRoutingRules,
  normalizeChainRoutingOptions,
} from '@/lib/chain-config-generator';
import type { ChainConfig, ChainRoutingOptions } from '@/types/chain';

// ─── Request Validation ─────────────────────────────────

const routingOptionsSchema = z.object({
  split: z
    .object({
      directGeoipTags: z.array(z.string()),
    })
    .optional(),
});

const chainConfigRequestSchema = z.object({
  templateId: z.string().min(1),
  panelMapping: z.record(z.coerce.number().int(), z.coerce.number().int()),
  routingOptions: routingOptionsSchema.optional(),
  // key = node index in template, value = RemotePanel.id
});

// ─── POST /api/panels/push/chain-config ──────────────

/**
 * Generate a ChainConfig from a template + panel mapping.
 * Uses RemotePanel data so that node.serverId = RemotePanel.id,
 * which matches what generatePerPanelConfig expects.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = chainConfigRequestSchema.safeParse(body);

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

    const { templateId, panelMapping, routingOptions } = parsed.data;

    // Validate template exists
    const template = getTemplateById(templateId);
    if (!template) {
      return NextResponse.json(
        { success: false, error: `Template not found: ${templateId}` },
        { status: 404 },
      );
    }

    let normalizedRoutingOptions: ChainRoutingOptions | undefined;
    try {
      normalizedRoutingOptions = normalizeChainRoutingOptions(
        template,
        routingOptions,
      );
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error:
            err instanceof Error
              ? err.message
              : 'Invalid chain routing options',
        },
        { status: 422 },
      );
    }

    // Validate node count to prevent IP octet overflow (10.0.0.X maxes at 254)
    const MAX_NODES = 10;
    if (template.nodes.length > MAX_NODES) {
      return NextResponse.json(
        {
          success: false,
          error: `Template requires ${template.nodes.length} nodes, maximum is ${MAX_NODES}`,
        },
        { status: 422 },
      );
    }

    // Validate all required node indices have a panel mapping
    for (let i = 0; i < template.nodes.length; i++) {
      if (panelMapping[i] === undefined) {
        return NextResponse.json(
          {
            success: false,
            error: `No panel mapping for node "${template.nodes[i].label}" at index ${i}`,
          },
          { status: 422 },
        );
      }
    }

    // Validate no duplicate panel assignments
    const panelIds = Object.values(panelMapping);
    const uniquePanelIds = new Set(panelIds);
    if (uniquePanelIds.size !== panelIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: 'Panel mapping contains duplicate panel assignments',
        },
        { status: 422 },
      );
    }

    // Fetch all referenced RemotePanel records
    const panels = await prisma.remotePanel.findMany({
      where: { id: { in: panelIds } },
      select: { id: true, name: true, panelUrl: true, isActive: true },
    });

    // Validate all panels exist
    const foundPanelIds = new Set(panels.map((p: { id: number }) => p.id));
    for (const panelId of panelIds) {
      if (!foundPanelIds.has(panelId)) {
        return NextResponse.json(
          { success: false, error: `Panel with ID ${panelId} not found` },
          { status: 404 },
        );
      }
    }

    // Validate all panels are active
    for (const panel of panels) {
      if (!panel.isActive) {
        return NextResponse.json(
          {
            success: false,
            error: `Panel "${panel.name}" (ID: ${panel.id}) is not active`,
          },
          { status: 422 },
        );
      }
    }

    // Build panel lookup
    const panelLookup = new Map<number, (typeof panels)[0]>();
    for (const p of panels) {
      panelLookup.set(p.id, p);
    }

    // Resolve template nodes with panel data and Tailscale transport
    const resolvedNodes = await Promise.all(
      template.nodes.map(async (node, index) => {
        const panelId = panelMapping[index];
        const panel = panelLookup.get(panelId)!;

        // Resolve WireGuard service port from Service model
        let wireguardPort = 51820;
        try {
          const wireguardService = await prisma.service.findFirst({
            where: { serverId: panel.id, type: 'AWG' },
            select: { port: true },
          });
          if (wireguardService?.port) {
            wireguardPort = wireguardService.port;
          }
        } catch {
          // Service lookup failed -- use default port
        }

        // Try Tailscale transport resolution via server record matching this panel
        const server = await prisma.server.findFirst({
          where: {
            hostname: { contains: new URL(panel.panelUrl).hostname },
          },
          select: {
            id: true,
            tailnetIP: true,
            tailnetHostname: true,
            hostname: true,
          },
        });

        const transport = server
          ? await resolvePanelTransport(
              server,
              { panelUrl: panel.panelUrl },
              wireguardPort,
            )
          : null;

        if (transport) {
          return {
            ...node,
            serverId: panel.id,
            hostname: transport.tailscaleIP,
            port: wireguardPort,
          };
        }

        // Fallback: parse from panelUrl (legacy behavior)
        console.warn(
          `[chain-config] Transport resolution failed for panel ${panel.name}, falling back to panelUrl parsing`,
        );
        let hostPart = panel.panelUrl.replace(/^https?:\/\//, '').split('/')[0];
        let port = wireguardPort;
        if (hostPart.includes(':')) {
          const [host, portStr] = hostPart.split(':');
          hostPart = host;
          port = parseInt(portStr, 10) || wireguardPort;
        }
        return {
          ...node,
          serverId: panel.id,
          hostname: hostPart,
          port,
        };
      }),
    );

    // Generate WireGuard peers and Xray routing rules
    const wireguardPeers = generateWireGuardPeers(template, resolvedNodes);
    const xrayRoutingRules = generateXrayRoutingRules(
      template,
      resolvedNodes,
      normalizedRoutingOptions,
    );

    const chainConfig: ChainConfig = {
      templateId: template.id,
      routingOptions: normalizedRoutingOptions,
      nodes: resolvedNodes,
      wireguardPeers,
      xrayRoutingRules,
      generatedAt: new Date().toISOString(),
    };

    await writeAuditLog({
      action: 'chain.config.generate',
      resource: 'chainConfig',
      resourceId: template.id,
      metadata: {
        templateId: template.id,
        panelIds,
        nodeCount: resolvedNodes.length,
      },
    });

    return NextResponse.json({ success: true, data: chainConfig });
  } catch (err) {
    console.error('[api/panels/push/chain-config] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to generate chain config',
      },
      { status: 500 },
    );
  }
}
