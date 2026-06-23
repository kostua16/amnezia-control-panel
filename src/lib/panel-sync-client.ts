import { signPayload } from './hmac';
import type { ChainConfig } from '@/types/chain';
import type {
  PanelSyncPayload,
  PanelChainNode,
  PanelRoutingRule,
  PushResult,
  PushAllResult,
} from '@/types/panel-sync.ts';
import { broadcastEvent } from './websocket';
import { enrichError } from './error-reporter';
import { resolvePanelTransport } from './transport-resolver';
import { httpClient } from './http-client';

// ─── Constants ──────────────────────────────────────────

const RETRY_DELAYS = [1000, 2000, 4000];

// Circuit breaker: track consecutive failures per panel
const panelFailures = new Map<number, number[]>();
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

// ─── Helpers ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a panel is degraded due to consecutive failures.
 * Tracks failures within a 5-minute window.
 */
function isPanelDegraded(panelId: number): boolean {
  const failures = panelFailures.get(panelId) || [];
  const now = Date.now();

  // Filter out old failures outside the window
  const recentFailures = failures.filter((ts) => now - ts < FAILURE_WINDOW_MS);
  panelFailures.set(panelId, recentFailures);

  return recentFailures.length >= MAX_CONSECUTIVE_FAILURES;
}

/**
 * Record a panel failure for circuit breaker tracking.
 */
function recordPanelFailure(panelId: number): void {
  const failures = panelFailures.get(panelId) || [];
  const now = Date.now();

  // Filter out old failures and add new one
  const recentFailures = failures.filter((ts) => now - ts < FAILURE_WINDOW_MS);
  recentFailures.push(now);
  panelFailures.set(panelId, recentFailures);
}

/**
 * Clear failure history for a panel (called on success).
 */
function clearPanelFailures(panelId: number): void {
  panelFailures.delete(panelId);
}

/**
 * Classify a push outcome as transient (worth retrying / tripping the breaker)
 * or deterministic. Network/timeout failures carry no HTTP status; 5xx responses
 * indicate a temporarily unavailable remote. 4xx client errors (401 auth, 403,
 * 400 bad config) are deterministic — retrying will not change the outcome, and
 * tripping the circuit breaker on them would mask the real cause behind a
 * misleading "degraded" state instead of letting each push surface the error.
 */
function isTransientFailure(status: number | null): boolean {
  if (status === null) return true; // network error / timeout (no response)
  return status >= 500; // 5xx is transient; 4xx is a deterministic client/config fault
}

interface ServerRecord {
  id: number;
  tailnetIP: string | null;
  tailnetHostname: string | null;
  hostname: string | null;
}

/**
 * In-memory server lookup that mirrors Prisma's `hostname: { contains }` +
 * `tailnetIP: { equals }` semantics. Exact tailnetIP match wins, then
 * substring hostname match.
 */
function findServerByHost(
  servers: ServerRecord[],
  urlHostname: string,
): ServerRecord | undefined {
  const byIP = servers.find((s) => s.tailnetIP === urlHostname);
  if (byIP) return byIP;
  return servers.find((s) => s.hostname?.includes(urlHostname));
}

// ─── generatePerPanelConfig ─────────────────────────────

/**
 * Generate a per-panel sync payload from a chain config.
 * Returns null if the panel has no role in this chain.
 */
export function generatePerPanelConfig(
  chainConfig: ChainConfig,
  panelId: number,
): PanelSyncPayload | null {
  const matchedNode = chainConfig.nodes.find(
    (node) => node.serverId === panelId,
  );

  if (!matchedNode) {
    return null;
  }

  // Include ALL chain nodes (full topology for routing decisions)
  const chainNodes: PanelChainNode[] = chainConfig.nodes.map((node) => ({
    label: node.label,
    serverId: node.serverId,
    role: node.role,
    protocol: node.protocol,
    hostname: node.hostname,
    port: node.port,
  }));

  // Filter routing rules: only those whose nodeId matches the matched node's label
  const routingRules: PanelRoutingRule[] = chainConfig.xrayRoutingRules
    .filter((rule) => rule.nodeId === matchedNode.label)
    .map((rule) => ({
      type: rule.type,
      value: rule.value,
      outboundTag: rule.outboundTag,
      priority: rule.priority,
    }));

  // Filter wireguard peers: only those whose nodeId matches the matched node's label
  const wireguardPeers = chainConfig.wireguardPeers
    .filter((peer) => peer.nodeId === matchedNode.label)
    .map((peer) => ({
      publicKey: peer.publicKey,
      allowedIPs: peer.allowedIPs,
      endpoint: peer.endpoint,
      persistentKeepalive: peer.persistentKeepalive,
    }));

  return {
    configVersion: 0, // Placeholder — real version set at push time
    panelRole: matchedNode.role,
    chainNodes,
    routingRules,
    wireguardPeers,
    generatedAt: chainConfig.generatedAt,
  };
}

// ─── pushConfigToPanel ──────────────────────────────────

/**
 * Push a config payload to a single remote panel.
 * Retries up to 3 times total with exponential backoff (1s, 2s, 4s).
 */
export async function pushConfigToPanel(
  panel: { id: number; name: string; panelUrl: string; apiKey: string },
  payload: PanelSyncPayload,
): Promise<PushResult> {
  const url = `${panel.panelUrl}/api/sync/receive`;
  const signature = signPayload(payload, panel.apiKey);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': panel.apiKey,
    'X-Signature': signature,
  };

  let lastError: string | null = null;
  // null = network/timeout failure (no HTTP response); otherwise the last HTTP status.
  let lastStatus: number | null = null;
  let retries = 0;
  const startTime = Date.now();

  // Check circuit breaker
  if (isPanelDegraded(panel.id)) {
    broadcastEvent('panel:push-progress', {
      panelId: panel.id,
      panelName: panel.name,
      status: 'degraded',
      error: `Panel degraded after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Check connectivity.`,
      timestamp: new Date().toISOString(),
    });

    return {
      panelId: panel.id,
      panelName: panel.name,
      success: false,
      configVersion: null,
      latencyMs: 0,
      error: `Panel degraded (${MAX_CONSECUTIVE_FAILURES} consecutive failures)`,
      retries: 0,
    };
  }

  // Initial attempt + up to 2 retries = 3 total attempts
  broadcastEvent('panel:push-progress', {
    panelId: panel.id,
    panelName: panel.name,
    status: 'pushing',
    timestamp: new Date().toISOString(),
  });

  // Fix: use strict inequality to make exactly 3 attempts (attempt 0, 1, 2)
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      const response = await httpClient(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        timeoutMs: 8000, // Reduced from 15s to 8s per Proposal 13
        retries: 0,
      });

      if (response.ok) {
        const resp = await response.json();
        const data = resp.data;
        if (data?.applied && typeof data.configVersion === 'number') {
          const latencyMs = Date.now() - startTime;
          clearPanelFailures(panel.id); // Clear failures on success
          broadcastEvent('panel:push-progress', {
            panelId: panel.id,
            panelName: panel.name,
            status: 'success',
            latencyMs,
            timestamp: new Date().toISOString(),
          });
          return {
            panelId: panel.id,
            panelName: panel.name,
            success: true,
            configVersion: data.configVersion,
            latencyMs,
            error: null,
            retries,
          };
        }
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
      lastStatus = response.status;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastStatus = null; // network/timeout failure — no HTTP response received
    }

    // If we have retries left, wait before trying again
    if (attempt < RETRY_DELAYS.length - 1) {
      retries++;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  // Only transient failures (network/timeout/5xx) count toward the circuit breaker.
  // Deterministic 4xx client errors (auth, config) are not retried-away and must keep
  // surfacing per push so the admin sees the real cause rather than a "degraded" mask.
  if (isTransientFailure(lastStatus)) {
    recordPanelFailure(panel.id);
  }

  broadcastEvent('panel:push-progress', {
    panelId: panel.id,
    panelName: panel.name,
    status: 'failed',
    error: enrichError(lastError || 'Unknown error', panel.name),
    timestamp: new Date().toISOString(),
  });

  return {
    panelId: panel.id,
    panelName: panel.name,
    success: false,
    configVersion: null,
    latencyMs: Date.now() - startTime,
    error: lastError,
    retries,
  };
}

// ─── pushConfigToAllPanels ──────────────────────────────

/**
 * Push chain config to all active remote panels in parallel.
 * Increments configVersion starting from 1 for each panel in the batch.
 */
export async function pushConfigToAllPanels(
  chainConfig: ChainConfig,
  panelApiKeys: Map<number, string>,
): Promise<PushAllResult> {
  const { prisma } = await import('./prisma');

  const [panels, allServers] = await Promise.all([
    prisma.remotePanel.findMany({ where: { isActive: true } }),
    prisma.server.findMany({
      select: {
        id: true,
        tailnetIP: true,
        tailnetHostname: true,
        hostname: true,
      },
    }),
  ]);

  const results: PushResult[] = [];
  let configVersion = 0;

  // Prepare all panel pushes
  const pushPromises = panels.map(async (panel) => {
    const panelConfig = generatePerPanelConfig(chainConfig, panel.id);

    if (!panelConfig) {
      // Panel has no role in this chain — skip
      return null;
    }

    const apiKey = panelApiKeys.get(panel.id);
    if (!apiKey) {
      return {
        panelId: panel.id,
        panelName: panel.name,
        success: false,
        configVersion: null,
        latencyMs: null,
        error: 'No API key provided for panel',
        retries: 0,
      };
    }

    configVersion++;
    panelConfig.configVersion = configVersion;

    // Resolve Tailscale transport address for this panel (in-memory lookup)
    let panelUrl = panel.panelUrl;
    try {
      const urlHostname = new URL(panel.panelUrl).hostname;
      const server = findServerByHost(allServers, urlHostname);

      if (server && server.hostname) {
        const transport = await resolvePanelTransport(
          server as Parameters<typeof resolvePanelTransport>[0],
          {
            panelUrl: panel.panelUrl,
          },
        );
        if (transport) {
          panelUrl = transport.panelUrl;
        }
      }
    } catch (err) {
      console.warn(
        `[panel-sync] Transport resolution failed for panel ${panel.name}, using panelUrl directly:`,
        err,
      );
    }

    return pushConfigToPanel(
      { id: panel.id, name: panel.name, panelUrl, apiKey },
      panelConfig,
    );
  });

  // Execute all pushes in parallel and collect results
  const settleResults = await Promise.allSettled(pushPromises);

  for (const settleResult of settleResults) {
    if (settleResult.status === 'fulfilled' && settleResult.value !== null) {
      results.push(settleResult.value);
    } else if (settleResult.status === 'rejected') {
      // Handle rejected promises (should be rare with our error handling)
      console.error('[panel-sync] Push promise rejected:', settleResult.reason);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    totalPanels: results.length,
    succeeded,
    failed,
    results,
    configVersion,
    pushedAt: new Date().toISOString(),
  };
}
