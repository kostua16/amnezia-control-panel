import fs from 'fs';
import path from 'path';
import { isIPv4 } from 'net';

// --- Constants ---

const GEOIP_DIR = path.join(process.cwd(), 'data', 'geoip');
const GEOIP_FILE = path.join(GEOIP_DIR, 'geoip.dat');

/** v2fly/geoip release URLs (per D-02) */
const GEOIP_DOWNLOAD_URLS = [
  'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
  'https://cdn.jsdelivr.net/gh/v2fly/geoip@release/geoip.dat',
];

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

interface CachedCountry {
  countryCode: string;
  cidrs: string[];
}

// --- Protobuf helpers ---

function readVarint(buffer: Buffer, offset: number): number {
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

function varintSize(buffer: Buffer, offset: number): number {
  let size = 0;
  while (offset + size < buffer.length) {
    size++;
    if ((buffer[offset + size - 1] & 0x80) === 0) break;
    if (size >= 10) break;
  }
  return Math.max(size, 1);
}

function matchesCIDR(ipNum: number, cidr: string): boolean {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return false;

  const ipStr = cidr.substring(0, slashIdx);
  const prefixStr = cidr.substring(slashIdx + 1);
  if (!ipStr || !prefixStr) return false;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const parts = ipStr.split('.');
  if (parts.length !== 4 || parts.some((p) => isNaN(Number(p)))) return false;

  const networkNum =
    (Number(parts[0]) << 24) |
    (Number(parts[1]) << 16) |
    (Number(parts[2]) << 8) |
    Number(parts[3]);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return (ipNum & mask) === (networkNum & mask);
}

// --- GeoIPManager singleton ---

class GeoIPManager {
  private countries: Map<string, CachedCountry> = new Map();
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
        this.setStatus({ loaded: false, error: 'GeoIP file is not a regular file' });
        return;
      }

      this.parseDatFile(GEOIP_FILE);
      this.status.loaded = true;
      this.status.fileSize = stat.size;
      this.status.lastRefreshed = stat.mtime.toISOString();
      this.status.stale = Date.now() - stat.mtime.getTime() > DEFAULT_REFRESH_INTERVAL_MS;
      this.status.error = null;
    } catch (err) {
      this.status.loaded = false;
      this.status.error = err instanceof Error ? err.message : 'Failed to load GeoIP file';
    }
  }

  // --- Parse v2fly geoip.dat format ---

  /**
   * Parse v2fly geoip.dat protobuf binary format.
   * message GeoIPList { repeated Country country_list = 1; }
   * message Country { string iso_code = 1; repeated CIDR cidr = 2; }
   * message CIDR { bytes ip = 1; uint32 prefix = 2; }
   */
  private parseDatFile(filePath: string): void {
    const buffer = fs.readFileSync(filePath);
    this.countries.clear();

    try {
      const countryEntries = this.decodeGeoIPProtobuf(buffer);

      for (const entry of countryEntries) {
        this.countries.set(entry.countryCode.toUpperCase(), {
          countryCode: entry.countryCode.toUpperCase(),
          cidrs: entry.cidrs,
        });
      }

      console.log(`[geoip] Loaded ${this.countries.size} countries from geoip.dat`);
    } catch (err) {
      this.status.loaded = false;
      this.status.error = `Failed to parse geoip.dat: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[geoip]', this.status.error);
    }
  }

  private decodeGeoIPProtobuf(buffer: Buffer): Array<{ countryCode: string; cidrs: string[] }> {
    const results: Array<{ countryCode: string; cidrs: string[] }> = [];
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

        const country = this.decodeCountryMessage(countryData);
        if (country && country.countryCode.length === 2) {
          results.push(country);
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

    return results;
  }

  private decodeCountryMessage(buffer: Buffer): { countryCode: string; cidrs: string[] } | null {
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

        const cidr = this.decodeCIDRMessage(cidrData);
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

  private decodeCIDRMessage(buffer: Buffer): string | null {
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
      const ipNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];

      for (const [, country] of this.countries) {
        for (const cidr of country.cidrs) {
          if (matchesCIDR(ipNum, cidr)) {
            return country.countryCode;
          }
        }
      }

      return null;
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
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(120_000),
          });

          if (!response.ok) continue;

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          if (buffer.length < 1000) {
            console.warn(`[geoip] Downloaded file from ${url} is too small (${buffer.length} bytes), skipping`);
            continue;
          }

          // Atomic write via temp file
          const tempPath = GEOIP_FILE + '.tmp';
          await fs.promises.writeFile(tempPath, buffer);
          await fs.promises.rename(tempPath, GEOIP_FILE);

          downloaded = true;
          console.log(`[geoip] Downloaded geoip.dat from ${url} (${buffer.length} bytes)`);
          break;
        } catch (err) {
          console.warn(`[geoip] Failed to download from ${url}:`, err);
          continue;
        }
      }

      if (!downloaded) {
        this.status.error = 'All download URLs failed';
        return { success: false, message: 'Failed to download from all sources' };
      }

      await this.loadFromFile();

      if (this.status.loaded) {
        return { success: true, message: `GeoIP database updated (${this.countries.size} countries)` };
      }
      return { success: false, message: 'Downloaded but failed to parse' };
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

    console.log(`[geoip] Refresh scheduler started (interval: ${intervalMs / 3_600_000}h)`);
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
export async function lookupGeoIP(ip: string): Promise<{ countryCode: string | null; region: string | null }> {
  const countryCode = geoIPManager.lookupCountry(ip);
  return { countryCode, region: null };
}

/** Get current GeoIP database status. */
export function getGeoIPStatus(): GeoIPStatus {
  return geoIPManager.getStatus();
}

/** Trigger a manual refresh. */
export async function refreshGeoIP(): Promise<{ success: boolean; message: string }> {
  return geoIPManager.refresh();
}
