import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTemplateById } from '@/lib/chain-templates';
import { prisma } from '@/lib/prisma';
import type { ChainConfig, WireGuardPeerConfig, XrayRoutingRule, ChainTemplate } from '@/types/chain';

// ─── Request Validation ─────────────────────────────────

const chainConfigRequestSchema = z.object({
  templateId: z.string().min(1),
  panelMapping: z.record(z.coerce.number().int(), z.coerce.number().int()),
  // key = node index in template, value = RemotePanel.id
});

// ─── WireGuard Peer Generation ─────────────────────────

function generateWireGuardPeers(
  template: ChainTemplate,
  nodes: Array<{ label: string; hostname: string; port: number }>,
): WireGuardPeerConfig[] {
  const peers: WireGuardPeerConfig[] = [];

  switch (template.topology) {
    case 'linear': {
      for (let i = 0; i < nodes.length - 1; i++) {
        const current = nodes[i];
        const next = nodes[i + 1];

        peers.push({
          nodeId: current.label,
          publicKey: `STUB_PUBKEY_${next.label.replace(/\s+/g, '_')}`,
          allowedIPs: '0.0.0.0/0',
          endpoint: `${next.hostname}:${next.port}`,
          persistentKeepalive: 25,
        });

        peers.push({
          nodeId: next.label,
          publicKey: `STUB_PUBKEY_${current.label.replace(/\s+/g, '_')}`,
          allowedIPs: `10.0.0.${i + 1}/32`,
          endpoint: `${current.hostname}:${current.port}`,
          persistentKeepalive: 25,
        });
      }
      break;
    }
    case 'split': {
      const domestic = nodes.find((n) => n.label.includes('Domestic') || n.label.includes('Direct'));
      const foreign = nodes.find((n) => n.label.includes('VPN') || n.label.includes('Foreign'));

      if (foreign) {
        peers.push({
          nodeId: foreign.label,
          publicKey: `STUB_PUBKEY_${foreign.label.replace(/\s+/g, '_')}`,
          allowedIPs: '0.0.0.0/0',
          endpoint: `${foreign.hostname}:${foreign.port}`,
          persistentKeepalive: 25,
        });
      }
      break;
    }
    case 'mesh': {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const current = nodes[i];
          const peer = nodes[j];

          peers.push({
            nodeId: current.label,
            publicKey: `STUB_PUBKEY_${peer.label.replace(/\s+/g, '_')}`,
            allowedIPs: `10.0.0.${j + 1}/32`,
            endpoint: `${peer.hostname}:${peer.port}`,
            persistentKeepalive: 25,
          });
        }
      }
      break;
    }
    default:
      throw new Error(`Unsupported topology: ${template.topology}`);
  }

  return peers;
}

// ─── Xray Routing Rule Generation ─────────────────────────

function generateXrayRoutingRules(
  template: ChainTemplate,
  nodes: Array<{ label: string; hostname: string; port: number }>,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];

  switch (template.topology) {
    case 'linear': {
      for (let i = 0; i < nodes.length - 1; i++) {
        const current = nodes[i];
        const next = nodes[i + 1];

        rules.push({
          nodeId: current.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${next.label.replace(/\s+/g, '_')}`,
          priority: i * 10,
        });

        rules.push({
          nodeId: current.label,
          type: 'ip',
          value: '10.0.0.0/8',
          outboundTag: 'direct',
          priority: (i * 10) + 1,
        });
      }

      const exitNode = nodes[nodes.length - 1];
      rules.push({
        nodeId: exitNode.label,
        type: 'ip',
        value: '0.0.0.0/0',
        outboundTag: 'direct',
        priority: (nodes.length - 1) * 10,
      });
      break;
    }
    case 'split': {
      const domestic = nodes.find((n) => n.label.includes('Domestic') || n.label.includes('Direct'));
      const foreign = nodes.find((n) => n.label.includes('VPN') || n.label.includes('Foreign'));

      if (domestic && foreign) {
        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'ru',
          outboundTag: 'direct',
          priority: 0,
        });

        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'private',
          outboundTag: 'direct',
          priority: 1,
        });

        rules.push({
          nodeId: domestic.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${foreign.label.replace(/\s+/g, '_')}`,
          priority: 10,
        });

        rules.push({
          nodeId: foreign.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'direct',
          priority: 0,
        });
      }
      break;
    }
    case 'mesh': {
      for (const node of nodes) {
        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'mesh_balancer',
          priority: 0,
        });

        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '10.0.0.0/8',
          outboundTag: 'direct',
          priority: 1,
        });
      }
      break;
    }
    default:
      throw new Error(`Unsupported topology: ${template.topology}`);
  }

  return rules;
}

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
        { success: false, error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const { templateId, panelMapping } = parsed.data;

    // Validate template exists
    const template = getTemplateById(templateId);
    if (!template) {
      return NextResponse.json(
        { success: false, error: `Template not found: ${templateId}` },
        { status: 404 },
      );
    }

    // Validate node count to prevent IP octet overflow (10.0.0.X maxes at 254)
    const MAX_NODES = 10;
    if (template.nodes.length > MAX_NODES) {
      return NextResponse.json(
        { success: false, error: `Template requires ${template.nodes.length} nodes, maximum is ${MAX_NODES}` },
        { status: 422 },
      );
    }

    // Validate all required node indices have a panel mapping
    for (let i = 0; i < template.nodes.length; i++) {
      if (panelMapping[i] === undefined) {
        return NextResponse.json(
          { success: false, error: `No panel mapping for node "${template.nodes[i].label}" at index ${i}` },
          { status: 422 },
        );
      }
    }

    // Validate no duplicate panel assignments
    const panelIds = Object.values(panelMapping);
    const uniquePanelIds = new Set(panelIds);
    if (uniquePanelIds.size !== panelIds.length) {
      return NextResponse.json(
        { success: false, error: 'Panel mapping contains duplicate panel assignments' },
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
          { success: false, error: `Panel "${panel.name}" (ID: ${panel.id}) is not active` },
          { status: 422 },
        );
      }
    }

    // Build panel lookup
    const panelLookup = new Map<number, typeof panels[0]>();
    for (const p of panels) {
      panelLookup.set(p.id, p);
    }

    // Resolve template nodes with panel data
    const resolvedNodes = template.nodes.map((node, index) => {
      const panelId = panelMapping[index];
      const panel = panelLookup.get(panelId)!;

      // Extract hostname and port from panelUrl (strip protocol and path)
      let hostPart = panel.panelUrl.replace(/^https?:\/\//, '').split('/')[0];
      let port = 3000; // default panel API port
      if (hostPart.includes(':')) {
        const [host, portStr] = hostPart.split(':');
        hostPart = host;
        port = parseInt(portStr, 10) || 3000;
      }
      const hostname = hostPart;

      return {
        ...node,
        serverId: panel.id,
        hostname,
        port,
      };
    });

    // Generate WireGuard peers and Xray routing rules
    const wireguardPeers = generateWireGuardPeers(template, resolvedNodes);
    const xrayRoutingRules = generateXrayRoutingRules(template, resolvedNodes);

    const chainConfig: ChainConfig = {
      templateId: template.id,
      nodes: resolvedNodes,
      wireguardPeers,
      xrayRoutingRules,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: chainConfig });
  } catch (err) {
    console.error('[api/panels/push/chain-config] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to generate chain config' },
      { status: 500 },
    );
  }
}
