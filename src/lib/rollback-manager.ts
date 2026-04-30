import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { PanelSyncPayload } from '@/types/panel-sync';
import type { StructuredPushError } from '@/types/config-push';
import { pushConfigToPanel } from '@/lib/panel-sync-client';
import { cachePanelApiKey } from '@/lib/panel-health-checker';

// ─── storePreviousConfig ─────────────────────────────────

/**
 * Store the current config as the previous config before it gets overwritten.
 * Must be called BEFORE writing a new config to CachedPanelConfig.
 * Copies current config/version/timestamp into the previous* fields.
 */
export async function storePreviousConfig(panelId: number): Promise<void> {
  const cached = await prisma.cachedPanelConfig.findUnique({
    where: { panelId },
  });

  if (!cached) {
    // No existing config — nothing to preserve as previous
    return;
  }

  await prisma.cachedPanelConfig.update({
    where: { panelId },
    data: {
      previousConfig: cached.config as Prisma.InputJsonValue,
      previousConfigVersion: cached.configVersion,
      previousConfigReceivedAt: cached.receivedAt,
    },
  });
}

// ─── rollbackPanelConfig ─────────────────────────────────

/**
 * Rollback a panel's config to its previous version in the database only.
 * Swaps previous -> current, clears previous fields.
 * One-level only: after rollback, previous fields are cleared (no deep history).
 * Use rollbackPanelConfigWithPush for the full rollback + remote push.
 */
export async function rollbackPanelConfig(
  panelId: number,
): Promise<{ success: boolean; configVersion: number | null; error: StructuredPushError | null }> {
  // 1. Fetch cached config
  const cached = await prisma.cachedPanelConfig.findUnique({
    where: { panelId },
  });

  if (!cached) {
    return {
      success: false,
      configVersion: null,
      error: {
        type: 'unknown',
        message: `No cached config found for panel ${panelId}`,
        recommendation: 'Push a config to this panel before attempting rollback',
        knownFix: null,
        rawError: null,
      },
    };
  }

  if (cached.previousConfig === null || cached.previousConfigVersion === null) {
    return {
      success: false,
      configVersion: null,
      error: {
        type: 'unknown',
        message: 'No previous config available for rollback',
        recommendation: 'A rollback requires at least two configs to have been pushed to this panel',
        knownFix: null,
        rawError: null,
      },
    };
  }

  // 2. Swap: previous becomes current, previous fields are cleared
  const restoredVersion = cached.previousConfigVersion;

  await prisma.cachedPanelConfig.update({
    where: { panelId },
    data: {
      config: cached.previousConfig as Prisma.InputJsonValue,
      configVersion: restoredVersion,
      receivedAt: cached.previousConfigReceivedAt ?? new Date(),
      previousConfig: Prisma.JsonNull,
      previousConfigVersion: null,
      previousConfigReceivedAt: null,
    },
  });

  return {
    success: true,
    configVersion: restoredVersion,
    error: null,
  };
}

// ─── rollbackPanelConfigWithPush ─────────────────────────

/**
 * Rollback a panel's config and re-push the restored config to the remote panel.
 * This is the full rollback + push variant used by the API endpoint.
 * Accepts an explicit API key since the plaintext key is needed for the push.
 */
export async function rollbackPanelConfigWithPush(
  panelId: number,
  apiKey: string,
): Promise<{ success: boolean; configVersion: number | null; error: StructuredPushError | null }> {
  // 1. Perform the DB swap
  const swapResult = await rollbackPanelConfig(panelId);
  if (!swapResult.success) {
    return swapResult;
  }

  // 2. Re-push the restored config to the remote panel
  try {
    const panel = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });

    if (!panel) {
      return {
        success: false,
        configVersion: swapResult.configVersion,
        error: {
          type: 'unknown',
          message: `Remote panel ${panelId} not found in database`,
          recommendation: 'The panel may have been deleted',
          knownFix: null,
          rawError: null,
        },
      };
    }

    // Fetch the now-restored config
    const cached = await prisma.cachedPanelConfig.findUnique({
      where: { panelId },
    });

    if (!cached) {
      return {
        success: false,
        configVersion: swapResult.configVersion,
        error: {
          type: 'unknown',
          message: 'Cached config disappeared after swap',
          recommendation: 'This is unexpected. Try pushing a new config.',
          knownFix: null,
          rawError: null,
        },
      };
    }

    const payload = cached.config as unknown as PanelSyncPayload;
    cachePanelApiKey(panelId, apiKey);

    const result = await pushConfigToPanel(
      { id: panel.id, name: panel.name, panelUrl: panel.panelUrl, apiKey },
      payload,
    );

    if (!result.success) {
      return {
        success: false,
        configVersion: swapResult.configVersion,
        error: {
          type: 'service_error',
          message: `Rollback succeeded locally but re-push failed: ${result.error}`,
          recommendation: 'The config has been rolled back in the database. The remote panel still has the newer config. Try pushing again.',
          knownFix: null,
          rawError: result.error,
        },
      };
    }

    return {
      success: true,
      configVersion: swapResult.configVersion,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      configVersion: swapResult.configVersion,
      error: {
        type: 'unknown',
        message: `Failed to re-push restored config: ${err instanceof Error ? err.message : String(err)}`,
        recommendation: 'Check panel connectivity and try again',
        knownFix: null,
        rawError: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
