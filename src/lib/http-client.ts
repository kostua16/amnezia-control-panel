/**
 * Shared HTTP client.
 *
 * Thin wrapper around `fetch` that standardizes timeout, retry, request/response
 * logging in development, and error enrichment. Returns the raw `Response` so
 * callers keep full control over status handling and streaming — the only
 * behavioral additions are timeout enforcement and optional 5xx/network retry.
 *
 * Retry only applies to idempotent methods by default, so a non-idempotent
 * POST/PUT/DELETE that omits `retries` cannot silently double-fire. Pass an
 * explicit `retries` value to override per call, or `retries: 0` to keep an
 * existing caller retry loop unchanged.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 500;
const IS_DEV = process.env.NODE_ENV !== 'production';

/** Methods safe to retry without risking duplicate side effects. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface HttpClientOptions extends Omit<RequestInit, 'signal'> {
  /** Abort the request after this many milliseconds (default 15000). */
  timeoutMs?: number;
  /**
   * Extra attempts on 5xx responses or network errors. Defaults to 1 for
   * idempotent methods (GET/HEAD/OPTIONS) and 0 for mutating verbs, so an
   * unconfigured POST/PUT/DELETE is never retried. Pass an explicit value to
   * override (e.g. `retries: 0` to disable, or a positive number to opt a
   * mutating call into retries when its side effects are idempotent).
   */
  retries?: number;
  /** Base backoff between retries, doubled each attempt (default 500ms). */
  retryDelayMs?: number;
}

/**
 * Enriched error thrown when a request fails after all retries are exhausted.
 * Network and timeout failures set `status: null`; HTTP status failures carry
 * the final response status so callers can branch on it if desired.
 */
export class HttpError extends Error {
  readonly url: string;
  readonly method: string;
  readonly status: number | null;
  readonly timedOut: boolean;

  constructor(params: {
    url: string;
    method: string;
    status: number | null;
    timedOut: boolean;
    cause?: unknown;
  }) {
    const statusLabel =
      params.status !== null ? `HTTP ${params.status}` : 'network error';
    const timeoutLabel = params.timedOut ? ' (timeout)' : '';
    super(
      `${params.method} ${params.url} failed: ${statusLabel}${timeoutLabel}`,
      // Preserve the underlying network/timeout error so `err.cause` stays
      // debuggable — that is the whole point of an enriched error type.
      params.cause !== undefined ? { cause: params.cause } : undefined,
    );
    this.name = 'HttpError';
    this.url = params.url;
    this.method = params.method;
    this.status = params.status;
    this.timedOut = params.timedOut;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

/**
 * Perform an HTTP request with timeout, optional retry, and dev-mode logging.
 *
 * Resolves with the `Response` for any HTTP status (mirrors `fetch`), including
 * 4xx/5xx — retry only happens on 5xx. Rejects with {@link HttpError} only when
 * every attempt fails with a network or timeout error.
 */
export async function httpClient(
  url: string,
  options: HttpClientOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    ...init
  } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  // Default to no retry for mutating verbs so a non-idempotent request can never
  // silently repeat (e.g. a duplicate config push); honor any explicit value.
  const idempotent = IDEMPOTENT_METHODS.has(method);
  const retries = options.retries ?? (idempotent ? DEFAULT_RETRIES : 0);
  const maxAttempts = retries + 1;

  let lastFailure: {
    status: number | null;
    timedOut: boolean;
    err: unknown;
  } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startedAt = IS_DEV ? Date.now() : 0;
    if (IS_DEV) {
      console.debug(
        `[http] ${method} ${url} (attempt ${attempt + 1}/${maxAttempts})`,
      );
    }

    try {
      const response = await fetch(url, {
        ...init,
        method,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (IS_DEV) {
        console.debug(
          `[http] ${method} ${url} -> ${response.status} (${Date.now() - startedAt}ms)`,
        );
      }

      if (isRetryableStatus(response.status) && attempt < retries) {
        lastFailure = { status: response.status, timedOut: false, err: null };
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }

      return response;
    } catch (err) {
      const timedOut = isTimeoutError(err);
      lastFailure = { status: null, timedOut, err };
      if (attempt < retries) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
    }
  }

  const failure = lastFailure ?? {
    status: null,
    timedOut: false,
    err: null,
  };
  throw new HttpError({
    url,
    method,
    status: failure.status,
    timedOut: failure.timedOut,
    cause: failure.err,
  });
}

/**
 * Fetch and parse JSON in one call. Throws {@link HttpError} for non-2xx
 * responses or network failures, so callers get a single consistent error path
 * for "get JSON or fail".
 */
export async function httpGetJson<T = unknown>(
  url: string,
  options: HttpClientOptions = {},
): Promise<T> {
  const response = await httpClient(url, { ...options, method: 'GET' });
  if (!response.ok) {
    throw new HttpError({
      url,
      method: 'GET',
      status: response.status,
      timedOut: false,
    });
  }
  return (await response.json()) as T;
}
