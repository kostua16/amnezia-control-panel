/**
 * Typed API client for frontend data hooks.
 *
 * Centralizes fetch boilerplate that was duplicated across 10+ hooks:
 * - URL construction with query params
 * - Consistent error parsing (reads server error JSON)
 * - Configurable timeout for reads and opt-in timeout for mutations
 * - Generic response typing
 *
 * Usage:
 *   apiGet<UsersResponse>('/api/users', { search: 'foo', page: 1 })
 *   apiMutate<CreateUserResponse>('/api/users', 'POST', { username: 'bob' })
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Default timeout for API requests (15 seconds).
 * Prevents hanging requests on slow/failed connections.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build URL with query parameters from an object.
 *
 * Filters out undefined values and converts to URLSearchParams.
 */
function buildUrl(path: string, params?: object): string {
  if (!params || Object.keys(params).length === 0) {
    return path;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Parse error response from server.
 *
 * Attempts to read { success: false, error: string } from response JSON.
 * Falls back to HTTP status message if JSON parsing fails.
 */
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const json = await response.json();
    if (
      json &&
      typeof json === 'object' &&
      'error' in json &&
      typeof json.error === 'string'
    ) {
      return json.error;
    }
  } catch {
    // JSON parsing failed, use status text
  }
  return `Request failed (status ${response.status})`;
}

/**
 * Typed GET request with timeout and error handling.
 *
 * @template T - Expected response data type
 * @param path - API path (e.g., '/api/users')
 * @param params - Optional query parameters
 * @param timeoutMs - Request timeout in milliseconds (default: 15000)
 * @returns Typed response data
 * @throws Error with server-provided message on failure
 */
export async function apiGet<T>(
  path: string,
  params?: object,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    const json = await response.json();
    return json as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Typed mutation request (POST/PUT/DELETE/PATCH) with error handling.
 *
 * @template T - Expected response data type
 * @param path - API path (e.g., '/api/users')
 * @param method - HTTP method ('POST', 'PUT', 'DELETE', 'PATCH')
 * @param body - Request body (will be JSON-stringified)
 * @param timeoutMs - Optional request timeout in milliseconds. Mutations do not
 * timeout by default because provisioning operations can legitimately take
 * longer than ordinary reads.
 * @returns Typed response data
 * @throws Error with server-provided message on failure
 */
export async function apiMutate<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  body?: unknown,
  timeoutMs: number | null = null,
): Promise<T> {
  const hasTimeout = typeof timeoutMs === 'number';
  const controller = hasTimeout ? new AbortController() : undefined;
  const timeoutId = hasTimeout
    ? setTimeout(() => controller?.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller?.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    const json = await response.json();
    return json as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && hasTimeout) {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
