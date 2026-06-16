import fs from 'fs';
import path from 'path';
import { isIPv4 } from 'net';
import { once } from 'node:events';

// --- Constants ---

const GEOIP_DIR = path.join(process.cwd(), 'data', 'geoip');
const GEOIP_FILE = path.join(GEOIP_DIR, 'geoip.dat');

/** Max bytes buffered by the file writer before backpressure (8 MiB). */
const GEOIP_DOWNLOAD_WRITE_HIGH_WATER_MARK = 8 * 1024 * 1024;

/** v2fly/geoip release URLs (per D-02). Fast CDN first — GitHub `latest` often hits the fetch timeout on slow links. */
const GEOIP_DOWNLOAD_URLS = [
  'https://cdn.jsdelivr.net/gh/v2fly/geoip@release/geoip.dat',
  'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
];

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Pipe a Web `ReadableStream` to disk with a small writable highWaterMark and drain backpressure.
 * Avoids `pipeline`/`fromWeb` internal buffering spikes on large bodies.
 *
 * @param totalBytes — from `Content-Length` when known; enables 10% milestone logs.
 */
async function streamWebResponseBodyToFile(
  body: ReadableStream<Uint8Array>,
  filePath: string,
  totalBytes: number | null = null,
): Promise<void> {
  const reader = body.getReader();
  const out = fs.createWriteStream(filePath, {
    highWaterMark: GEOIP_DOWNLOAD_WRITE_HIGH_WATER_MARK,
  });

  let endedCleanly = false;
  let downloaded = 0;
  /** Next 10% milestone to log (10 … 100) when totalBytes is set. */
  let nextPctMilestone = 10;
  /** Bytes threshold for MiB-only logs when size is unknown. */
  let nextUnknownLogAt = 5 * 1024 * 1024;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;

      downloaded += value.byteLength;

      if (totalBytes != null && totalBytes > 0) {
        const pct = Math.min(100, Math.floor((downloaded / totalBytes) * 100));
        while (nextPctMilestone <= 100 && pct >= nextPctMilestone) {
          console.info(
            `[geoip] Download ${nextPctMilestone}% (${formatMiB(downloaded)} / ${formatMiB(totalBytes)})`,
          );
          nextPctMilestone += 10;
        }
      } else if (downloaded >= nextUnknownLogAt) {
        console.info(`[geoip] Downloaded ${formatMiB(downloaded)}…`);
        nextUnknownLogAt += 5 * 1024 * 1024;
      }

      const ok = out.write(value);
      if (!ok) {
        await once(out, 'drain');
      }
    }

    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    endedCleanly = true;
  } catch (err) {
    if (!endedCleanly) {
      out.destroy(err instanceof Error ? err : undefined);
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/** Default refresh interval: 24 hours (per D-03) */
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// --- Types ---

export interface GeoIPStatus {
  loaded: boolean;
  stale: boolean;
  lastRefreshed: string | null;
  fileSize: number | null;
  error: string | null;
}

export interface CachedCountry {
  countryCode: string;
  cidrs: string[];
}

// --- Protobuf helpers ---

export function readVarint(buffer: Buffer, offset: number): number {
  let result = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    result |= (byte & 0x7f) << shift;
    offset++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 70) break;
  }
  return result >>> 0;
}

export function varintSize(buffer: Buffer, offset: number): number {
  let size = 0;
  while (offset + size < buffer.length) {
    size++;
    if ((buffer[offset + size - 1] & 0x80) === 0) break;
    if (size >= 10) break;
  }
  return Math.max(size, 1);
}

/**
 * Parse a `"a.b.c.d/prefix"` CIDR into its unsigned 32-bit network address
 * (host bits cleared) and prefix mask. Returns null for malformed input.
 *
 * `matchesCIDR` compares `(ipNum & mask)` against this masked network, so all
 * lookup paths share the same CIDR parsing and matching semantics.
 */
export function cidrToNetworkAndMask(
  cidr: string,
): { network: number; mask: number; prefix: number } | null {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return null;

  const ipStr = cidr.substring(0, slashIdx);
  const prefixStr = cidr.substring(slashIdx + 1);
  if (!ipStr || !prefixStr) return null;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const parts = ipStr.split('.');
  if (parts.length !== 4 || parts.some((p) => isNaN(Number(p)))) return null;

  const raw =
    (Number(parts[0]) << 24) |
    (Number(parts[1]) << 16) |
    (Number(parts[2]) << 8) |
    Number(parts[3]);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (raw & mask) >>> 0;
  return { network, mask, prefix };
}

export function matchesCIDR(ipNum: number, cidr: string): boolean {
  const parsed = cidrToNetworkAndMask(cidr);
  if (!parsed) return false;
  return (ipNum & parsed.mask) >>> 0 === parsed.network;
}

/**
 * Minimum plausible country count for a valid geoip.dat download. The real
 * v2fly database ships >250 countries; a corrupt, truncated, or HTML-error-page
 * download that still parses yields far fewer and is rejected so the working
 * database is never overwritten by bad data.
 */
export const MIN_COUNTRY_COUNT = 100;

/**
 * Parse a v2fly geoip.dat protobuf buffer into a fresh country map. Pure: no
 * instance state, so a downloaded file can be validated before swapping the
 * live database.
 *
 * message GeoIPList { repeated Country country_list = 1; }
 * message Country { string iso_code = 1; repeated CIDR cidr = 2; }
 * message CIDR { bytes ip = 1; uint32 prefix = 2; }
 */
export function parseGeoIPBuffer(buffer: Buffer): Map<string, CachedCountry> {
  const countries = new Map<string, CachedCountry>();
  decodeGeoIPProtobufIntoMap(buffer, countries);
  return countries;
}

/** Decode a GeoIPList buffer into the given map (avoids a large intermediate array). */
function decodeGeoIPProtobufIntoMap(
  buffer: Buffer,
  countries: Map<string, CachedCountry>,
): void {
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset += varintSize(buffer, offset);

    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      const countryData = buffer.subarray(offset, offset + length);
      offset += length;

      const country = decodeCountryMessage(countryData);
      if (country && country.countryCode.length === 2) {
        const code = country.countryCode.toUpperCase();
        countries.set(code, { countryCode: code, cidrs: country.cidrs });
      }
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset) + length;
    } else if (wireType === 0) {
      offset += varintSize(buffer, offset);
    } else {
      break;
    }
  }
}

function decodeCountryMessage(
  buffer: Buffer,
): { countryCode: string; cidrs: string[] } | null {
  let offset = 0;
  let countryCode = '';
  const cidrs: string[] = [];

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset += varintSize(buffer, offset);

    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      countryCode = buffer.subarray(offset, offset + length).toString('utf-8');
      offset += length;
    } else if (fieldNumber === 2 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      const cidrData = buffer.subarray(offset, offset + length);
      offset += length;

      const cidr = decodeCIDRMessage(cidrData);
      if (cidr) cidrs.push(cidr);
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset) + length;
    } else if (wireType === 0) {
      offset += varintSize(buffer, offset);
    } else {
      break;
    }
  }

  return countryCode ? { countryCode, cidrs } : null;
}

function decodeCIDRMessage(buffer: Buffer): string | null {
  let offset = 0;
  let ip: Buffer | null = null;
  let prefix = 0;

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset += varintSize(buffer, offset);

    if (fieldNumber === 1 && wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
      ip = buffer.subarray(offset, offset + length);
      offset += length;
    } else if (fieldNumber === 2 && wireType === 0) {
      prefix = readVarint(buffer, offset);
      offset += varintSize(buffer, offset);
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset += varintSize(buffer, offset) + length;
    } else if (wireType === 0) {
      offset += varintSize(buffer, offset);
    } else {
      break;
    }
  }

  if (!ip) return null;
  if (ip.length !== 4) return null; // IPv4 only per D-06

  const ipStr = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
  return `${ipStr}/${prefix}`;
}

// --- Lookup index ---

/** A node in the IPv4 longest-prefix-match lookup trie. */
export interface GeoIPLookupEntry {
  countryCode: string | null;
  children: [GeoIPLookupEntry | null, GeoIPLookupEntry | null];
}

/**
 * Build a longest-prefix-match trie over every CIDR in the country map.
 *
 * Nested/overlapping CIDRs are valid in real GeoIP data. Lookup policy is
 * therefore explicit: the most-specific prefix wins, and duplicate prefixes keep
 * the last country encountered during deterministic Map/CIDR iteration.
 */
export function buildLookupIndex(
  countries: Map<string, CachedCountry>,
): GeoIPLookupEntry {
  const root: GeoIPLookupEntry = { countryCode: null, children: [null, null] };
  for (const [, country] of countries) {
    for (const cidr of country.cidrs) {
      const parsed = cidrToNetworkAndMask(cidr);
      if (!parsed) continue;

      let node = root;
      for (let bitIndex = 31; bitIndex >= 32 - parsed.prefix; bitIndex--) {
        const bit = ((parsed.network >>> bitIndex) & 1) as 0 | 1;
        node.children[bit] ??= { countryCode: null, children: [null, null] };
        node = node.children[bit];
      }
      node.countryCode = country.countryCode;
    }
  }
  return root;
}

/**
 * Look up the country for an unsigned 32-bit IPv4 via longest prefix match.
 * This is bounded to 32 steps per query and handles nested CIDR ranges.
 */
export function lookupCountryInIndex(
  index: GeoIPLookupEntry,
  ipNum: number,
): string | null {
  const ip = ipNum >>> 0;
  let node: GeoIPLookupEntry | null = index;
  let match = node.countryCode;

  for (let bitIndex = 31; bitIndex >= 0; bitIndex--) {
    const bit = ((ip >>> bitIndex) & 1) as 0 | 1;
    node = node.children[bit];
    if (!node) break;
    if (node.countryCode) match = node.countryCode;
  }

  return match;
}

// --- GeoIPManager singleton ---

class GeoIPManager {
  private countries: Map<string, CachedCountry> = new Map();
  private lookupIndex: GeoIPLookupEntry = buildLookupIndex(this.countries);
  private status: GeoIPStatus = {
    loaded: false,
    stale: false,
    lastRefreshed: null,
    fileSize: null,
    error: null,
  };
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  // --- Initialization ---

  async init(): Promise<void> {
    await fs.promises.mkdir(GEOIP_DIR, { recursive: true });
    await this.loadFromFile();
    this.startScheduler(DEFAULT_REFRESH_INTERVAL_MS);
  }

  // --- Load from disk ---

  private async loadFromFile(): Promise<void> {
    try {
      const stat = await fs.promises.stat(GEOIP_FILE);
      if (!stat.isFile()) {
        this.setStatus({
          loaded: false,
          error: 'GeoIP file is not a regular file',
        });
        return;
      }

      this.parseDatFile(GEOIP_FILE);
      this.status.loaded = true;
      this.status.fileSize = stat.size;
      this.status.lastRefreshed = stat.mtime.toISOString();
      this.status.stale =
        Date.now() - stat.mtime.getTime() > DEFAULT_REFRESH_INTERVAL_MS;
      this.status.error = null;
    } catch (err) {
      this.status.loaded = false;
      this.status.error =
        err instanceof Error ? err.message : 'Failed to load GeoIP file';
    }
  }

  // --- Parse v2fly geoip.dat format ---

  /**
   * Parse the on-disk geoip.dat into the live country map. Used at startup
   * (`init`) to load an already-verified database file.
   */
  private parseDatFile(filePath: string): void {
    const buffer = fs.readFileSync(filePath);

    try {
      this.countries = parseGeoIPBuffer(buffer);
      this.lookupIndex = buildLookupIndex(this.countries);

      console.log(
        `[geoip] Loaded ${this.countries.size} countries from geoip.dat`,
      );
    } catch (err) {
      this.countries = new Map();
      this.lookupIndex = buildLookupIndex(this.countries);
      this.status.loaded = false;
      this.status.error = `Failed to parse geoip.dat: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[geoip]', this.status.error);
    }
  }

  // --- Lookup ---

  /**
   * Look up an IPv4 address and return its country code.
   * Per D-04: fail open -- return null on any failure.
   * Per D-06: IPv4 only -- return null for IPv6.
   */
  lookupCountry(ip: string): string | null {
    if (!this.status.loaded) return null;
    if (!isIPv4(ip)) return null;

    try {
      const parts = ip.split('.').map(Number);
      const ipNum =
        ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>>
        0;

      return lookupCountryInIndex(this.lookupIndex, ipNum);
    } catch {
      return null;
    }
  }

  // --- Status ---

  getStatus(): GeoIPStatus {
    return { ...this.status };
  }

  // --- Refresh ---

  async refresh(): Promise<{ success: boolean; message: string }> {
    if (this.refreshing) {
      return { success: false, message: 'Refresh already in progress' };
    }

    this.refreshing = true;

    try {
      let downloaded = false;
      for (const url of GEOIP_DOWNLOAD_URLS) {
        const tempPath = GEOIP_FILE + '.tmp';
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(120_000),
          });

          if (!response.ok) continue;
          if (!response.body) continue;

          // Reject HTML error pages (CDN/GitHub 200-with-HTML) before trusting the body.
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.toLowerCase().includes('text/html')) {
            console.warn(
              `[geoip] ${url} returned Content-Type '${contentType}' (likely an error page); skipping`,
            );
            continue;
          }

          const contentLength = response.headers.get('content-length');
          const parsedLen =
            contentLength != null ? parseInt(contentLength, 10) : NaN;
          const totalBytes =
            Number.isFinite(parsedLen) && parsedLen > 0 ? parsedLen : null;

          console.info(
            `[geoip] Saving to disk${totalBytes != null ? ` (${formatMiB(totalBytes)} expected)` : ''}…`,
          );

          try {
            await streamWebResponseBodyToFile(
              response.body,
              tempPath,
              totalBytes,
            );
          } catch (streamErr) {
            await fs.promises.rm(tempPath, { force: true }).catch(() => {});
            throw streamErr;
          }

          const stat = await fs.promises.stat(tempPath);
          if (stat.size < 1000) {
            console.warn(
              `[geoip] Downloaded file from ${url} is too small (${stat.size} bytes), skipping`,
            );
            await fs.promises.rm(tempPath, { force: true }).catch(() => {});
            continue;
          }

          // Validate the download BEFORE swapping the live file: parse the temp
          // file into a fresh map and require a plausible country count. A
          // corrupt or truncated download is rejected so the working database is
          // preserved instead of being overwritten.
          let parsed: Map<string, CachedCountry>;
          try {
            parsed = parseGeoIPBuffer(await fs.promises.readFile(tempPath));
          } catch (parseErr) {
            console.warn(
              `[geoip] Downloaded file from ${url} failed to parse; keeping existing database`,
              parseErr,
            );
            await fs.promises.rm(tempPath, { force: true }).catch(() => {});
            continue;
          }

          if (parsed.size < MIN_COUNTRY_COUNT) {
            console.warn(
              `[geoip] Downloaded file from ${url} parsed with only ${parsed.size} countries (expected >= ${MIN_COUNTRY_COUNT}); rejecting as corrupt/truncated`,
            );
            await fs.promises.rm(tempPath, { force: true }).catch(() => {});
            continue;
          }

          // Validated — adopt the parsed map and swap the file atomically.
          await fs.promises.rename(tempPath, GEOIP_FILE);
          this.countries = parsed;
          this.lookupIndex = buildLookupIndex(parsed);
          this.status.loaded = true;
          this.status.fileSize = stat.size;
          this.status.lastRefreshed = stat.mtime.toISOString();
          this.status.stale = false;
          this.status.error = null;

          downloaded = true;
          console.log(
            `[geoip] Downloaded geoip.dat from ${url} (${stat.size} bytes, ${parsed.size} countries)`,
          );
          break;
        } catch (err) {
          await fs.promises.rm(tempPath, { force: true }).catch(() => {});
          console.warn(`[geoip] Failed to download from ${url}:`, err);
          continue;
        }
      }

      if (!downloaded) {
        this.status.error = 'All download URLs failed';
        return {
          success: false,
          message: 'Failed to download from all sources',
        };
      }

      return {
        success: true,
        message: `GeoIP database updated (${this.countries.size} countries)`,
      };
    } finally {
      this.refreshing = false;
    }
  }

  // --- Scheduler ---

  startScheduler(intervalMs: number = DEFAULT_REFRESH_INTERVAL_MS): void {
    this.stopScheduler();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error('[geoip] Scheduled refresh failed:', err);
      });
    }, intervalMs);

    if (this.refreshTimer.unref) {
      this.refreshTimer.unref();
    }

    console.log(
      `[geoip] Refresh scheduler started (interval: ${intervalMs / 3_600_000}h)`,
    );
  }

  stopScheduler(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // --- Helpers ---

  private setStatus(partial: Partial<GeoIPStatus>): void {
    Object.assign(this.status, partial);
  }
}

// --- Singleton export ---

export const geoIPManager = new GeoIPManager();

// --- Convenience exports ---

/** Lookup country code for an IPv4 address. Per D-04: fail open on any error. */
export async function lookupGeoIP(
  ip: string,
): Promise<{ countryCode: string | null; region: string | null }> {
  const countryCode = geoIPManager.lookupCountry(ip);
  return { countryCode, region: null };
}

/** Get current GeoIP database status. */
export function getGeoIPStatus(): GeoIPStatus {
  return geoIPManager.getStatus();
}

/** Trigger a manual refresh. */
export async function refreshGeoIP(): Promise<{
  success: boolean;
  message: string;
}> {
  return geoIPManager.refresh();
}
