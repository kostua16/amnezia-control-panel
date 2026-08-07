import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody } from '@/lib/parse-body';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/hmac';
import { verifyValue, fastHash } from '@/lib/password';
import { writeAuditLog } from '@/lib/audit-log';

/**
 * Reject sync payloads whose generatedAt timestamp drifts further than this
 * window from server time. HMAC authenticates payload content but not
 * freshness, so a byte-for-byte replay of a real (API-key + HMAC-signed)
 * request still verifies. This window is the replay defense.
 */
const SYNC_FRESHNESS_MS = 5 * 60 * 1000;

const panelSyncPayloadSchema = z.object({
  configVersion: z.number().int().positive(),
  panelRole: z.enum(['entry', 'middle', 'exit', 'domestic', 'foreign']),
  chainNodes: z.array(
    z.object({
      label: z.string(),
      serverId: z.number().int(),
      role: z.enum(['entry', 'middle', 'exit', 'domestic', 'foreign']),
      protocol: z.enum(['wireguard', 'xray']),
      hostname: z.string(),
      port: z.number().int(),
    }),
  ),
  routingRules: z.array(
    z.object({
      type: z.enum(['ip', 'domain', 'geoip']),
      value: z.string(),
      outboundTag: z.string(),
      priority: z.number().int(),
    }),
  ),
  wireguardPeers: z.array(
    z.object({
      publicKey: z.string(),
      allowedIPs: z.string(),
      endpoint: z.string(),
      persistentKeepalive: z.number().int().optional(),
    }),
  ),
  generatedAt: z.string().min(1),
});

const generatedAtSchema = z.string().datetime({ offset: true });

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

    // 2. Auth check: O(1) fast-hash lookup, then bcrypt verify on match
    const candidate = await prisma.remotePanel.findFirst({
      where: { isActive: true, apiKeyFastHash: fastHash(apiKey) },
    });

    if (!candidate) {
      return NextResponse.json(
        { success: false, error: 'Invalid API key' },
        { status: 401 },
      );
    }

    const isValid = await verifyValue(apiKey, candidate.apiKeyHash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid API key' },
        { status: 401 },
      );
    }

    // 3. Parse request body
    const body = JSON.parse(await readBody(request));

    // 4. Zod validation
    const parsed = panelSyncPayloadSchema.safeParse(body);
    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid payload structure';
      return NextResponse.json(
        { success: false, error: `Invalid payload: ${firstError}` },
        { status: 400 },
      );
    }

    const configData = parsed.data;

    // 5. HMAC signature verification
    if (!verifySignature(body, apiKey, signature)) {
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 },
      );
    }

    // 6. Idempotency check: skip if same configVersion already cached
    const existingConfig = await prisma.cachedPanelConfig.findUnique({
      where: { panelId: candidate.id },
    });

    if (
      existingConfig &&
      existingConfig.configVersion === configData.configVersion
    ) {
      await writeAuditLog({
        action: 'sync.receive.idempotent',
        resource: 'cachedPanelConfig',
        resourceId: candidate.id,
        metadata: {
          panelId: candidate.id,
          configVersion: configData.configVersion,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          applied: true,
          configVersion: configData.configVersion,
          message: 'Config already applied (idempotent)',
        },
      });
    }

    const generatedAt = generatedAtSchema.safeParse(configData.generatedAt);
    const generatedAtMs = generatedAt.success
      ? Date.parse(generatedAt.data)
      : Number.NaN;
    if (Number.isNaN(generatedAtMs)) {
      return NextResponse.json(
        { success: false, error: 'Stale payload' },
        { status: 409 },
      );
    }

    const ageMs = Math.abs(Date.now() - generatedAtMs);
    if (ageMs > SYNC_FRESHNESS_MS) {
      return NextResponse.json(
        { success: false, error: 'Stale payload' },
        { status: 409 },
      );
    }

    // 6b. Monotonic version: ignore down-versioned replays. A captured older
    // payload must not downgrade the cached routing/WireGuard config. Equal
    // versions were handled above, so this catches strictly older versions.
    if (
      existingConfig &&
      configData.configVersion <= existingConfig.configVersion
    ) {
      await writeAuditLog({
        action: 'sync.receive.stale-version',
        resource: 'cachedPanelConfig',
        resourceId: candidate.id,
        metadata: {
          panelId: candidate.id,
          receivedVersion: configData.configVersion,
          currentVersion: existingConfig.configVersion,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          applied: false,
          configVersion: existingConfig.configVersion,
          message: 'Stale version ignored',
        },
      });
    }

    // 7-8. Store config atomically with rollback preservation.
    // Re-read the current config INSIDE the transaction so concurrent
    // pushes serialize: a second push sees the first push's committed
    // config as "previous", keeping the rollback chain intact. Reading
    // the previous-config fields from the pre-transaction snapshot would
    // let two concurrent pushes both snapshot the same config and drop
    // one from the rollback chain (TOCTOU).
    await prisma.$transaction(async (tx) => {
      const current = await tx.cachedPanelConfig.findUnique({
        where: { panelId: candidate.id },
      });

      if (current) {
        await tx.cachedPanelConfig.update({
          where: { id: current.id },
          data: {
            previousConfig: current.config as Prisma.InputJsonValue,
            previousConfigVersion: current.configVersion,
            previousConfigReceivedAt: current.receivedAt,
            configVersion: configData.configVersion,
            config: configData,
            receivedAt: new Date(),
          },
        });
      } else {
        await tx.cachedPanelConfig.create({
          data: {
            panelId: candidate.id,
            configVersion: configData.configVersion,
            config: configData,
            receivedAt: new Date(),
          },
        });
      }

      // Audit log inside the same transaction
      await tx.auditLog.create({
        data: {
          action: 'sync.receive',
          resource: 'cachedPanelConfig',
          resourceId: String(candidate.id),
          metadata: JSON.stringify({
            panelId: candidate.id,
            configVersion: configData.configVersion,
            panelRole: configData.panelRole,
          }),
        },
      });
    });

    // 8. Return success
    return NextResponse.json({
      success: true,
      data: {
        applied: true,
        configVersion: configData.configVersion,
      },
    });
  } catch (err) {
    console.error('[api/sync/receive] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to process sync' },
      { status: 500 },
    );
  }
}
