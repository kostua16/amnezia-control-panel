import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateChainConfig, applyChainConfig } from '@/lib/chain-router';
import { getTemplateById } from '@/lib/chain-templates';
import { normalizeChainRoutingOptions } from '@/lib/chain-config-generator';
import { cachePanelApiKey } from '@/lib/panel-health-checker';
import { resolvePanelTransport } from '@/lib/transport-resolver';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';
import type { ChainRoutingOptions } from '@/types/chain';

const routingOptionsSchema = z.object({
  split: z
    .object({
      directGeoipTags: z.array(z.string()),
    })
    .optional(),
});

const applyChainSchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  serverMapping: z
    .record(z.coerce.number().int(), z.coerce.number().int())
    .refine(
      (mapping) => Object.keys(mapping).length > 0,
      'At least one server mapping is required',
    ),
  /** Plaintext API keys for each panel: { panelId: apiKey } */
  panelApiKeys: z.record(z.coerce.number().int(), z.string()).optional(),
  routingOptions: routingOptionsSchema.optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = applyChainSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { templateId, serverMapping, panelApiKeys, routingOptions } =
    parsed.data;

  // Validate template exists
  const template = getTemplateById(templateId);
  if (!template) {
    return error(`Template not found: ${templateId}`, 404);
  }

  let normalizedRoutingOptions: ChainRoutingOptions | undefined;
  try {
    normalizedRoutingOptions = normalizeChainRoutingOptions(
      template,
      routingOptions,
    );
  } catch (err) {
    return error(
      err instanceof Error ? err.message : 'Invalid chain routing options',
      422,
    );
  }

  // Validate all required server slots are mapped
  const nodeIndices = template.nodes.map((_, i) => i);
  const mappedIndices = Object.keys(serverMapping).map(Number);

  for (const idx of nodeIndices) {
    if (!mappedIndices.includes(idx)) {
      return error(
        `Missing server mapping for node "${template.nodes[idx].label}"`,
        422,
      );
    }
  }

  // Fetch all referenced servers
  const serverIds = [...new Set(Object.values(serverMapping))];
  const servers = await prisma.server.findMany({
    where: { id: { in: serverIds } },
  });

  if (servers.length !== serverIds.length) {
    const foundIds = new Set(servers.map((s) => s.id));
    const missing = serverIds.filter((id) => !foundIds.has(id));
    return error(`Servers not found: ${missing.join(', ')}`, 404);
  }

  // Generate chain configuration
  const chainConfig = await generateChainConfig(
    templateId,
    servers.map((s) => ({
      id: s.id,
      name: s.name,
      hostname: s.hostname,
      port: s.port,
      isActive: s.isActive,
      createdAt: s.createdAt,
    })),
    serverMapping,
    normalizedRoutingOptions,
  );

  // Build panel credentials map using Tailscale transport resolution.
  // RemotePanel has no serverId FK, so we match panels to chain nodes by
  // hostname correlation and panelId lookup in the caller-provided panelApiKeys.
  const panelCredentials = new Map<
    number,
    { panelUrl: string; apiKey: string }
  >();

  if (panelApiKeys && Object.keys(panelApiKeys).length > 0) {
    // Cache API keys for future auto-resync
    for (const [panelId, apiKey] of Object.entries(panelApiKeys)) {
      cachePanelApiKey(Number(panelId), apiKey);
    }

    // Fetch all active remote panels (no serverId filter -- field does not exist)
    const remotePanels = await prisma.remotePanel.findMany({
      where: { isActive: true },
    });

    for (const node of chainConfig.nodes) {
      // Match RemotePanel to chain node by hostname correlation
      let matchedPanel = remotePanels.find((p) => {
        try {
          return (
            p.panelUrl.includes(node.hostname) ||
            node.hostname.includes(new URL(p.panelUrl).hostname)
          );
        } catch {
          return false;
        }
      });

      // Fallback: match by panelId via serverMapping (node.serverId === panel.id)
      if (!matchedPanel) {
        matchedPanel = remotePanels.find((p) => p.id === node.serverId);
      }

      if (!matchedPanel) {
        continue;
      }

      // Get API key from caller-provided panelApiKeys, keyed by panelId or serverId
      const apiKey =
        panelApiKeys?.[matchedPanel.id] ?? panelApiKeys?.[node.serverId];
      if (!apiKey) {
        continue;
      }

      // Resolve Tailscale transport address for the server behind this panel
      const server = await prisma.server.findFirst({
        where: { id: node.serverId },
        select: {
          id: true,
          tailnetIP: true,
          tailnetHostname: true,
          hostname: true,
        },
      });

      let panelUrl = matchedPanel.panelUrl; // Default to registered panelUrl

      if (server) {
        const transport = await resolvePanelTransport(server, {
          panelUrl: matchedPanel.panelUrl,
        });
        if (transport) {
          panelUrl = transport.panelUrl;
        }
      }

      panelCredentials.set(node.serverId, { panelUrl, apiKey });
    }
  }

  // Apply the chain configuration to all servers
  const applyResult = await applyChainConfig(
    chainConfig,
    undefined,
    panelCredentials,
  );

  await writeAuditLog({
    action: 'chain.apply',
    resource: 'chainConfig',
    resourceId: chainConfig.templateId,
    outcome: applyResult.success ? 'success' : 'failure',
    metadata: {
      templateId: chainConfig.templateId,
      nodeCount: chainConfig.nodes.length,
      appliedTo: applyResult.appliedTo,
      errors: applyResult.errors,
    },
  });

  return NextResponse.json({
    success: applyResult.success,
    data: {
      templateId: chainConfig.templateId,
      nodes: chainConfig.nodes.map((n) => ({
        label: n.label,
        role: n.role,
        protocol: n.protocol,
        hostname: n.hostname,
        port: n.port,
      })),
      wireguardPeers: chainConfig.wireguardPeers,
      xrayRoutingRules: chainConfig.xrayRoutingRules,
      appliedTo: applyResult.appliedTo,
      errors: applyResult.errors,
      generatedAt: chainConfig.generatedAt,
    },
  });
}, 'api/chains/apply');
