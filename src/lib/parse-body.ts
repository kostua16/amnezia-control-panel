import { NextRequest, NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';
import { error } from './api-response';

/** Default maximum request body size: 1 MiB. */
const DEFAULT_MAX_SIZE_BYTES = 1024 * 1024;

/**
 * Read a request body stream with a byte-size limit.
 * Returns the raw body text or throws a 413 if the limit is exceeded.
 *
 * Standalone export for routes that do not use `apiHandler()` or need
 * manual body parsing.
 */
export async function readBody(
  request: NextRequest,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxSizeBytes) {
      reader.cancel();
      throw new BodySizeLimitError(maxSizeBytes, totalBytes);
    }

    chunks.push(value);
  }

  // Combine chunks into a single Uint8Array for decode
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

/**
 * Parse a request body with size limit and Zod validation.
 * Returns a typed, validated payload.
 *
 * @throws BodySizeLimitError — body exceeds maxSizeBytes (mapped to 413 by apiHandler)
 * @throws ZodError — body fails schema validation (mapped to 422 by apiHandler)
 */
export async function parseBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
): Promise<T> {
  const raw = await readBody(request, maxSizeBytes);
  const json: unknown = JSON.parse(raw);
  return schema.parse(json);
}

/**
 * Error thrown when a request body exceeds the size limit.
 * Carries the limit and actual size so error handlers can include detail.
 */
export class BodySizeLimitError extends Error {
  readonly limit: number;
  readonly actual: number;
  readonly status = 413;

  constructor(limit: number, actual: number) {
    super(`Request body size ${actual} bytes exceeds limit of ${limit} bytes`);
    this.name = 'BodySizeLimitError';
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Map a BodySizeLimitError to a 413 JSON response. Callers that do not use
 * apiHandler can catch BodySizeLimitError and pass it here directly.
 */
export function bodySizeLimitResponse(err: BodySizeLimitError): NextResponse {
  return error(err.message, 413);
}
