/**
 * Test helpers for invoking Next.js App Router route handlers directly.
 *
 * Route handlers are plain async functions exported from `route.ts` files
 * (`GET`, `POST`, `PUT`, `DELETE`). Instead of booting the full Next.js server,
 * unit tests construct a `NextRequest`, call the handler, and assert on the
 * returned `Response`. This module removes the boilerplate that each route
 * test otherwise duplicates (URL construction, JSON body serialization,
 * response parsing).
 *
 * These helpers are test-only infrastructure; they are never imported by
 * production code.
 */
import { NextRequest } from 'next/server';

/** Base origin used to build absolute URLs; value is arbitrary for unit tests. */
const BASE_URL = 'http://localhost';
type NextRequestInit = NonNullable<
  ConstructorParameters<typeof NextRequest>[1]
>;

/** Build an absolute URL for a route path with optional query parameters. */
export function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean>,
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface JsonRequestInit {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A `NextRequest` carrying a JSON body, for POST/PUT/PATCH/DELETE handlers. */
export function jsonRequest(
  path: string,
  options: {
    method?: HttpMethod;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const { method = 'POST', body, headers = {} } = options;
  const init: NextRequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(buildUrl(path), init);
}

/** A `NextRequest` for a GET handler, with optional query string params. */
export function getRequest(
  path: string,
  query?: Record<string, string | number | boolean>,
): NextRequest {
  return new NextRequest(buildUrl(path, query));
}

/** Convenience wrappers for the common HTTP verbs. */
export const postRequest = (
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => jsonRequest(path, { method: 'POST', body, headers });
export const putRequest = (
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => jsonRequest(path, { method: 'PUT', body, headers });
export const patchRequest = (
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => jsonRequest(path, { method: 'PATCH', body, headers });
export const deleteRequest = (
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => jsonRequest(path, { method: 'DELETE', body, headers });

/** Parsed response shape returned by {@link readJson}. */
export interface TestJsonDataItem {
  [key: string]: unknown;
  assignedServices: string[];
  hostname: string;
  matchType: string;
  target: { countryCode: string };
  username: string;
}

export interface TestJsonData {
  [index: number]: TestJsonDataItem;
  [key: string]: unknown;
  action: string;
  applied: boolean;
  configVersion: number;
  generatedAt: string;
  id: number;
  length: number;
  nodes: Array<{ hostname: string }>;
  target: { countryCode: string };
  templateId: string;
  wireguardPeers: unknown[];
  xrayRoutingRules: unknown[];
}

export interface TestJsonBody {
  [key: string]: unknown;
  data: TestJsonData;
  details: unknown;
  error: string;
  pagination: { total: number; totalPages: number };
  success: boolean;
  user: { username: string };
}

export interface ParsedResponse<T = TestJsonBody> {
  status: number;
  body: T;
}

/**
 * Read a `Response` (or `NextResponse`) into `{ status, body }` in one await.
 * Centralizes the `const res = …; const body = await res.json()` pair that
 * otherwise repeats in every assertion.
 */
export async function readJson<T = TestJsonBody>(
  res: Response,
): Promise<ParsedResponse<T>> {
  const body = (await res.json()) as T;
  return { status: res.status, body };
}
