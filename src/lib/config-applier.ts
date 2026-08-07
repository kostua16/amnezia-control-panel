import type { PanelSyncPayload } from '@/types/panel-sync';
import type { ConfigApplierResult } from '@/types/config-push';
import { enrichError } from './error-reporter';
import { pushToPanel } from './panel-push';

/** Human-readable label for each push target, used in 404 error messages. */
const SERVICE_LABELS: Record<ConfigApplierResult['service'], string> = {
  awg: 'AWG',
  three_xui: '3x-ui',
};

// ─── Shared remote-push helper ────────────────────────────

/**
 * Push a pre-built payload to a remote panel's /api/sync/apply endpoint.
 *
 * Shared by the AWG and 3x-ui appliers: both sign the payload, POST it with the
 * same headers and timeout, and interpret the response identically. Only the
 * body payload shape differs, which each caller builds before delegating here.
 *
 * Never throws — failures are returned as a ConfigApplierResult with a
 * structured error so callers can aggregate per-panel results.
 */
async function pushToRemotePanel(params: {
  panelUrl: string;
  panelName: string;
  apiKey: string;
  bodyPayload: Record<string, unknown>;
  service: ConfigApplierResult['service'];
}): Promise<ConfigApplierResult> {
  const { panelUrl, panelName, apiKey, bodyPayload, service } = params;
  const serviceLabel = SERVICE_LABELS[service];

  const result = await pushToPanel({
    panelUrl,
    panelName,
    apiKey,
    payload: bodyPayload,
    endpoint: '/api/sync/apply',
    retries: 0,
  });

  // Success path: the remote panel responded 2xx. Interpret the body the same
  // way the original inline implementation did — `data.applied` gates success,
  // and a missing/empty body is treated as "not applied" (descriptive message)
  // rather than falling through to an opaque "Unknown error".
  if (result.success) {
    const data = result.data;
    if (data?.applied) {
      return {
        success: true,
        service,
        panelName,
        latencyMs: result.latencyMs,
        error: null,
      };
    }
    // Remote returned applied=false (or sent no usable data)
    const msg =
      (data?.message as string) || 'Remote panel did not apply the config';
    return {
      success: false,
      service,
      panelName,
      latencyMs: result.latencyMs,
      error: enrichError(msg, panelName),
    };
  }

  if (result.status === 404) {
    // Remote panel does not have the apply endpoint -- this is a real failure
    console.error(
      `[config-applier] Remote panel ${panelName} returned 404 for /api/sync/apply. Config was NOT applied.`,
    );
    return {
      success: false,
      service,
      panelName,
      latencyMs: result.latencyMs,
      error: {
        type: 'service_error',
        message: `Remote panel ${panelName} does not have /api/sync/apply. Config was NOT applied to ${serviceLabel} services.`,
        recommendation:
          'Update the remote panel to the latest version that supports the apply endpoint',
        knownFix: 'Run git pull and restart the remote panel service',
        rawError: 'HTTP 404: /api/sync/apply not found',
      },
    };
  }

  return {
    success: false,
    service,
    panelName,
    latencyMs: result.latencyMs,
    error: result.error ?? {
      type: 'unknown',
      message: 'Unknown error',
      recommendation: '',
      knownFix: null,
      rawError: null,
    },
  };
}

// ─── applyAwgConfig ────────────────────────────────────────

/**
 * Apply WireGuard peer configuration to a remote panel.
 *
 * Sends the peer config to the remote panel's `/api/sync/apply` endpoint.
 * If the endpoint returns 404 (remote doesn't support apply yet), returns
 * a success result with a warning noting the config was not applied.
 */
export async function applyAwgConfig(
  panelUrl: string,
  panelName: string,
  apiKey: string,
  wireguardPeers: PanelSyncPayload['wireguardPeers'],
): Promise<ConfigApplierResult> {
  // Construct WireGuard config format: [Peer] sections
  const wgConfig = wireguardPeers
    .map((peer) => {
      const lines = ['[Peer]'];
      lines.push(`PublicKey = ${peer.publicKey}`);
      lines.push(`AllowedIPs = ${peer.allowedIPs}`);
      lines.push(`Endpoint = ${peer.endpoint}`);
      if (peer.persistentKeepalive != null) {
        lines.push(`PersistentKeepalive = ${peer.persistentKeepalive}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return pushToRemotePanel({
    panelUrl,
    panelName,
    apiKey,
    bodyPayload: { service: 'awg', config: wgConfig },
    service: 'awg',
  });
}

// ─── applyThreeXuiConfig ───────────────────────────────────

/**
 * Apply Xray routing rules to the 3x-ui REST API on a remote panel.
 *
 * Sends routing rules to the remote panel's `/api/sync/apply` endpoint,
 * which proxies them to the local 3x-ui instance. Rules are JSON-serialized
 * (not string-interpolated) so rule values cannot break out of the payload.
 */
export async function applyThreeXuiConfig(
  panelUrl: string,
  panelName: string,
  apiKey: string,
  xrayRules: PanelSyncPayload['routingRules'],
): Promise<ConfigApplierResult> {
  return pushToRemotePanel({
    panelUrl,
    panelName,
    apiKey,
    bodyPayload: { service: 'three_xui', routingRules: xrayRules },
    service: 'three_xui',
  });
}

// ─── applyPanelConfig ──────────────────────────────────────

/**
 * Apply configuration to a remote panel, dispatching to the correct
 * service(s) based on the payload's chain node protocols.
 *
 * Does NOT throw -- always returns results with errors embedded.
 */
export async function applyPanelConfig(
  panelUrl: string,
  panelName: string,
  apiKey: string,
  payload: PanelSyncPayload,
): Promise<ConfigApplierResult[]> {
  const results: ConfigApplierResult[] = [];

  // Determine which services this panel uses
  const hasWireguard = payload.chainNodes.some(
    (node) => node.protocol === 'wireguard',
  );
  const hasXray = payload.chainNodes.some((node) => node.protocol === 'xray');

  if (hasWireguard && payload.wireguardPeers.length > 0) {
    const result = await applyAwgConfig(
      panelUrl,
      panelName,
      apiKey,
      payload.wireguardPeers,
    );
    results.push(result);
  }

  if (hasXray && payload.routingRules.length > 0) {
    const result = await applyThreeXuiConfig(
      panelUrl,
      panelName,
      apiKey,
      payload.routingRules,
    );
    results.push(result);
  }

  // If no services were dispatched, return a no-op success
  if (results.length === 0) {
    results.push({
      success: true,
      service: 'awg',
      panelName,
      latencyMs: 0,
      error: null,
    });
  }

  return results;
}
