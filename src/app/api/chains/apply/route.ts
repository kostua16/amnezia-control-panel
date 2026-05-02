import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateChainConfig, applyChainConfig } from '@/lib/chain-router';
import { getTemplateById } from '@/lib/chain-templates';
import { cachePanelApiKey } from '@/lib/panel-health-checker';

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
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = applyChainSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { templateId, serverMapping, panelApiKeys } = parsed.data;

    // Validate template exists
    const template = getTemplateById(templateId);
    if (!template) {
      return NextResponse.json(
        { success: false, error: `Template not found: ${templateId}` },
        { status: 404 },
      );
    }

    // Validate all required server slots are mapped
    const nodeIndices = template.nodes.map((_, i) => i);
    const mappedIndices = Object.keys(serverMapping).map(Number);

    for (const idx of nodeIndices) {
      if (!mappedIndices.includes(idx)) {
        return NextResponse.json(
          {
            success: false,
            error: `Missing server mapping for node "${template.nodes[idx].label}"`,
          },
          { status: 422 },
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
      return NextResponse.json(
        {
          success: false,
          error: `Servers not found: ${missing.join(', ')}`,
        },
        { status: 404 },
      );
    }

    // Generate chain configuration
    const chainConfig = generateChainConfig(
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
    );

    // Build panel credentials map from RemotePanel table
    // The API key for signing must come from the caller; for local chain apply,
    // we query panels matching the chain node serverIds.
    const remotePanels = await prisma.remotePanel.findMany({
      where: {
        isActive: true,
        serverId: { in: chainConfig.nodes.map((n) => n.serverId) },
      },
    });

    // Build panel credentials from caller-provided API keys.
    // The caller (ChainFlowEditor / ChainBuilder) collects keys from the admin at save time.
    // Plaintext keys are cached in memory for auto-resync (never persisted to DB).
    const panelCredentials = new Map<number, { panelUrl: string; apiKey: string }>();

    if (panelApiKeys && Object.keys(panelApiKeys).length > 0) {
      // Cache API keys for future auto-resync
      for (const [panelId, apiKey] of Object.entries(panelApiKeys)) {
        cachePanelApiKey(Number(panelId), apiKey);
      }

      // Build panelCredentials by matching node serverId to RemotePanel
      for (const panel of remotePanels) {
        const apiKey = panelApiKeys[panel.serverId] ?? panelApiKeys[panel.id];
        if (apiKey) {
          panelCredentials.set(panel.serverId, {
            panelUrl: panel.panelUrl,
            apiKey,
          });
        }
      }
    }

    // Apply the chain configuration to all servers
    const applyResult = await applyChainConfig(chainConfig, undefined, panelCredentials);

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
  } catch (err) {
    console.error('[api/chains/apply] Error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to apply chain configuration';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
