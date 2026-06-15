import type { PanelSyncPayload } from '@/types/panel-sync';
import type { ConfigApplierResult } from '@/types/config-push';
import { signPayload } from './hmac';
import { enrichError } from './error-reporter';

// ─── Shell Metacharacter Guard ────────────────────────────

const DANGEROUS_CHARS = /[;|&$`\\]/;

function validateNoInjection(value: string): void {
  if (DANGEROUS_CHARS.test(value)) {
    throw new Error(`Rejected value containing shell metacharacters: ${value}`);
  }
}

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
  const startTime = Date.now();
  const serviceLabel = SERVICE_LABELS[service];

  try {
    const body = JSON.stringify(bodyPayload);
    const signature = signPayload(bodyPayload, apiKey);

    const response = await fetch(`${panelUrl}/api/sync/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const resp = await response.json();
      const data = resp.data;
      if (data?.applied) {
        return {
          success: true,
          service,
          panelName,
          latencyMs: Date.now() - startTime,
          error: null,
        };
      }
      // Remote returned applied=false
      const msg = data?.message || 'Remote panel did not apply the config';
      return {
        success: false,
        service,
        panelName,
        latencyMs: Date.now() - startTime,
        error: enrichError(msg, panelName),
      };
    }

    if (response.status === 404) {
      // Remote panel does not have the apply endpoint -- this is a real failure
      console.error(
        `[config-applier] Remote panel ${panelName} returned 404 for /api/sync/apply. Config was NOT applied.`,
      );
      return {
        success: false,
        service,
        panelName,
        latencyMs: Date.now() - startTime,
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

    // Other HTTP error
    const errorText = await response
      .text()
      .catch(() => `HTTP ${response.status}`);
    return {
      success: false,
      service,
      panelName,
      latencyMs: Date.now() - startTime,
      error: enrichError(`HTTP ${response.status}: ${errorText}`, panelName),
    };
  } catch (err) {
    const rawError = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      service,
      panelName,
      latencyMs: Date.now() - startTime,
      error: enrichError(rawError, panelName),
    };
  }
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
  // Validate peer values against shell injection
  for (const peer of wireguardPeers) {
    validateNoInjection(peer.publicKey);
    validateNoInjection(peer.allowedIPs);
    validateNoInjection(peer.endpoint);
  }

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
