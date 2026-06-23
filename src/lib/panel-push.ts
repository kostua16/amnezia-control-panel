import { signPayload } from './hmac';
import { enrichError } from './error-reporter';
import { httpClient } from './http-client';

// ─── Types ────────────────────────────────────────────

export interface PanelPushOptions {
  /** Remote panel base URL (e.g. "https://panel.example.com") */
  panelUrl: string;
  /** Human-readable panel name for error messages */
  panelName: string;
  /** API key for HMAC signing and X-API-Key header */
  apiKey: string;
  /** JSON-serializable payload to push */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  /** Endpoint path (e.g. "/api/sync/receive" or "/api/sync/apply") */
  endpoint: string;
  /** Number of retry attempts (0 = no retry) */
  retries?: number;
}

export interface PanelPushResult {
  /** Whether the remote panel accepted the push */
  success: boolean;
  /** Round-trip latency in milliseconds */
  latencyMs: number;
  /** Enriched error with actionable recommendations, null on success */
  error: import('@/types/config-push').StructuredPushError | null;
  /** Parsed response data from the remote panel */
  data?: Record<string, unknown>;
  /** Number of retries consumed */
  retries: number;
}

// ─── Retry delay schedule ────────────────────────────

const RETRY_DELAYS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── pushToPanel ────────────────────────────────────

/**
 * Push a signed payload to a remote panel endpoint.
 *
 * Shared primitive for all panel-to-panel HTTP pushes. Handles:
 * - HMAC-SHA256 payload signing
 * - Standard headers (Content-Type, X-API-Key, X-Signature)
 * - HTTP POST with 15-second timeout
 * - Optional exponential backoff retry
 * - Error enrichment via pattern-matched recommendations
 *
 * Never throws — failures are returned as PanelPushResult with
 * error populated.
 */
export async function pushToPanel(
  options: PanelPushOptions,
): Promise<PanelPushResult> {
  const {
    panelUrl,
    panelName,
    apiKey,
    payload,
    endpoint,
    retries = 0,
  } = options;
  const url = `${panelUrl}${endpoint}`;
  const signature = signPayload(payload, apiKey);
  const body = JSON.stringify(payload);
  const maxAttempts = 1 + Math.min(retries, RETRY_DELAYS.length);
  const startTime = Date.now();

  let lastError: string | null = null;
  let attemptRetries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await httpClient(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Signature': signature,
        },
        body,
        timeoutMs: 15_000,
        retries: 0,
      });

      if (response.ok) {
        const resp = await response.json();
        return {
          success: true,
          latencyMs: Date.now() - startTime,
          error: null,
          data: resp.data,
          retries: attemptRetries,
        };
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxAttempts - 1) {
      attemptRetries++;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  return {
    success: false,
    latencyMs: Date.now() - startTime,
    error: enrichError(lastError || 'Unknown error', panelName),
    retries: attemptRetries,
  };
}
