import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody } from '@/lib/parse-body';
import { pushConfigToAllPanels } from '@/lib/panel-sync-client';
import { cachePanelApiKey } from '@/lib/panel-health-checker';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';

// ─── Request Validation ─────────────────────────────────

const routingOptionsSchema = z.object({
  split: z
    .object({
      directGeoipTags: z.array(z.string()),
    })
    .optional(),
});

const pushRequestSchema = z.object({
  chainConfig: z.object({
    templateId: z.string().min(1),
    routingOptions: routingOptionsSchema.optional(),
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
export const POST = apiHandler(async (request: NextRequest) => {
  const body = JSON.parse(await readBody(request));
  const parsed = pushRequestSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
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

  await writeAuditLog({
    action: 'panel.push',
    resource: 'remotePanel',
    outcome: pushAllResult.failed === 0 ? 'success' : 'failure',
    metadata: {
      templateId: chainConfig.templateId,
      totalPanels: pushAllResult.totalPanels,
      succeeded: pushAllResult.succeeded,
      failed: pushAllResult.failed,
    },
  });

  return NextResponse.json({ success: true, data: pushAllResult });
}, 'api/panels/push');
