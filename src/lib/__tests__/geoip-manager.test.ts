import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  geoIPManager,
  matchesCIDR,
  MIN_COUNTRY_COUNT,
  parseGeoIPBuffer,
  readVarint,
  varintSize,
  cidrToNetworkAndMask,
  buildLookupIndex,
  lookupCountryInIndex,
  type CachedCountry,
} from '../geoip-manager';

// --- readVarint ---

describe('readVarint', () => {
  it('decodes a single-byte varint (0)', () => {
    const buf = Buffer.from([0x00]);
    assert.strictEqual(readVarint(buf, 0), 0);
  });

  it('decodes a single-byte varint (1)', () => {
    const buf = Buffer.from([0x01]);
    assert.strictEqual(readVarint(buf, 0), 1);
  });

  it('decodes a single-byte varint (127 = max single-byte)', () => {
    const buf = Buffer.from([0x7f]);
    assert.strictEqual(readVarint(buf, 0), 127);
  });

  it('decodes a two-byte varint (128 → 0x80 0x01)', () => {
    const buf = Buffer.from([0x80, 0x01]);
    assert.strictEqual(readVarint(buf, 0), 128);
  });

  it('decodes a two-byte varint (300)', () => {
    // 300 = 0b100101100 → varint: 0b10101100 0b00000010 = 0xac 0x02
    const buf = Buffer.from([0xac, 0x02]);
    assert.strictEqual(readVarint(buf, 0), 300);
  });

  it('respects the offset parameter', () => {
    const buf = Buffer.from([0xff, 0x01]);
    // At offset 0: 0xff & 0x7f = 127, continues → next byte 0x01 → 127 + (1 << 7) = 255
    assert.strictEqual(readVarint(buf, 0), 255);
    // At offset 1: just 0x01
    assert.strictEqual(readVarint(buf, 1), 1);
  });
});

// --- varintSize ---

describe('varintSize', () => {
  it('returns 1 for a single-byte varint', () => {
    assert.strictEqual(varintSize(Buffer.from([0x00]), 0), 1);
    assert.strictEqual(varintSize(Buffer.from([0x7f]), 0), 1);
  });

  it('returns 2 for a two-byte varint', () => {
    assert.strictEqual(varintSize(Buffer.from([0x80, 0x01]), 0), 2);
  });

  it('returns 1 minimum even at buffer end', () => {
    assert.strictEqual(varintSize(Buffer.from([0x80]), 0), 1);
  });
});

// --- matchesCIDR ---

describe('matchesCIDR', () => {
  // Helper: convert "a.b.c.d" to 32-bit unsigned integer
  function ipToNum(ip: string): number {
    const p = ip.split('.').map(Number);
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }

  it('matches an IP within a /24 CIDR', () => {
    const ipNum = ipToNum('192.168.1.42');
    assert.strictEqual(matchesCIDR(ipNum, '192.168.1.0/24'), true);
  });

  it('rejects an IP outside a /24 CIDR', () => {
    const ipNum = ipToNum('192.168.2.42');
    assert.strictEqual(matchesCIDR(ipNum, '192.168.1.0/24'), false);
  });

  it('matches an IP within a /16 CIDR', () => {
    const ipNum = ipToNum('10.20.30.40');
    assert.strictEqual(matchesCIDR(ipNum, '10.20.0.0/16'), true);
  });

  it('matches an IP within a /8 CIDR', () => {
    const ipNum = ipToNum('10.200.30.40');
    assert.strictEqual(matchesCIDR(ipNum, '10.0.0.0/8'), true);
  });

  it('matches a /32 (exact IP)', () => {
    const ipNum = ipToNum('1.2.3.4');
    assert.strictEqual(matchesCIDR(ipNum, '1.2.3.4/32'), true);
    assert.strictEqual(matchesCIDR(ipNum, '1.2.3.5/32'), false);
  });

  it('matches a /0 (all IPs)', () => {
    const ipNum = ipToNum('255.255.255.255');
    assert.strictEqual(matchesCIDR(ipNum, '0.0.0.0/0'), true);
  });

  it('matches the network address itself', () => {
    const ipNum = ipToNum('192.168.1.0');
    assert.strictEqual(matchesCIDR(ipNum, '192.168.1.0/24'), true);
  });

  it('matches the broadcast address', () => {
    const ipNum = ipToNum('192.168.1.255');
    assert.strictEqual(matchesCIDR(ipNum, '192.168.1.0/24'), true);
  });

  it('returns false for CIDR without a slash', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '1.2.3.4'), false);
  });

  it('returns false for invalid prefix', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '1.2.3.4/abc'), false);
  });

  it('returns false for prefix out of range (>32)', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '1.2.3.4/33'), false);
  });

  it('returns false for prefix out of range (<0)', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '1.2.3.4/-1'), false);
  });

  it('returns false for empty IP part', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '/24'), false);
  });

  it('returns false for empty prefix part', () => {
    assert.strictEqual(matchesCIDR(ipToNum('1.2.3.4'), '1.2.3.4/'), false);
  });

  it('handles boundary between /25 subnets', () => {
    // 192.168.1.127 is the last host in 192.168.1.0/25
    assert.strictEqual(
      matchesCIDR(ipToNum('192.168.1.127'), '192.168.1.0/25'),
      true,
    );
    // 192.168.1.128 is the first in the second /25
    assert.strictEqual(
      matchesCIDR(ipToNum('192.168.1.128'), '192.168.1.0/25'),
      false,
    );
    assert.strictEqual(
      matchesCIDR(ipToNum('192.168.1.128'), '192.168.1.128/25'),
      true,
    );
  });
});

// --- cidrToNetworkAndMask ---

describe('cidrToNetworkAndMask', () => {
  it('parses a normalized /24 into a masked network and mask', () => {
    const parsed = cidrToNetworkAndMask('192.168.1.0/24');
    assert.ok(parsed);
    assert.strictEqual(parsed.network, 0xc0_a801_00); // 192.168.1.0
    assert.strictEqual(parsed.mask, 0xffffff_00);
  });

  it('clears host bits from a non-normalized CIDR', () => {
    // 10.1.2.3/8 → network 10.0.0.0 (host bits cleared by the mask).
    const parsed = cidrToNetworkAndMask('10.1.2.3/8');
    assert.ok(parsed);
    assert.strictEqual(parsed.network, 0x0a_000000);
    assert.strictEqual(parsed.mask, 0xff_000000);
  });

  it('treats /0 as the catch-all (mask 0, network 0)', () => {
    const parsed = cidrToNetworkAndMask('0.0.0.0/0');
    assert.ok(parsed);
    assert.strictEqual(parsed.network, 0);
    assert.strictEqual(parsed.mask, 0);
  });

  it('treats /32 as an exact-address mask', () => {
    const parsed = cidrToNetworkAndMask('9.9.9.9/32');
    assert.ok(parsed);
    assert.strictEqual(parsed.network, 0x0909_0909);
    assert.strictEqual(parsed.mask, 0xffff_ffff);
  });

  it('returns null for malformed input', () => {
    assert.strictEqual(cidrToNetworkAndMask('1.2.3.4'), null);
    assert.strictEqual(cidrToNetworkAndMask('1.2.3.4/'), null);
    assert.strictEqual(cidrToNetworkAndMask('/24'), null);
    assert.strictEqual(cidrToNetworkAndMask('1.2.3.4/abc'), null);
    assert.strictEqual(cidrToNetworkAndMask('1.2.3.4/33'), null);
    assert.strictEqual(cidrToNetworkAndMask('1.2.3.4/-1'), null);
  });
});

// --- buildLookupIndex + lookupCountryInIndex ---

describe('buildLookupIndex + lookupCountryInIndex', () => {
  function makeCountry(code: string, cidrs: string[]): CachedCountry {
    return { countryCode: code, cidrs };
  }

  function ipNum(ip: string): number {
    const p = ip.split('.').map(Number);
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }

  it('returns the country whose range contains the address', () => {
    const map = new Map<string, CachedCountry>([
      ['CN', makeCountry('CN', ['1.0.0.0/8'])],
      ['DE', makeCountry('DE', ['8.8.8.0/24'])],
      ['US', makeCountry('US', ['10.0.0.0/8', '192.168.1.0/24'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('1.2.3.4')), 'CN');
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('8.8.8.8')), 'DE');
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('10.1.2.3')), 'US');
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('192.168.1.42')), 'US');
  });

  it('falls back to a parent prefix when a nested child does not contain the address', () => {
    const map = new Map<string, CachedCountry>([
      ['PA', makeCountry('PA', ['8.0.0.0/8'])],
      ['CH', makeCountry('CH', ['8.8.8.0/24'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('8.8.9.5')), 'PA');
  });

  it('returns the most-specific country for a nested child prefix', () => {
    const map = new Map<string, CachedCountry>([
      ['PA', makeCountry('PA', ['8.0.0.0/8'])],
      ['CH', makeCountry('CH', ['8.8.8.0/24'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('8.8.8.5')), 'CH');
  });

  it('handles same-country nested prefixes without losing parent-only regions', () => {
    const map = new Map<string, CachedCountry>([
      ['US', makeCountry('US', ['8.0.0.0/8', '8.8.8.0/24'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('8.8.8.5')), 'US');
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('8.8.9.5')), 'US');
  });

  it('returns null for an address in a gap between disjoint ranges', () => {
    const map = new Map<string, CachedCountry>([
      ['US', makeCountry('US', ['10.0.0.0/8'])],
    ]);
    const idx = buildLookupIndex(map);
    // 172.16.0.1 sorts above 10.0.0.0 but is outside the /8 range.
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('172.16.0.1')), null);
  });

  it('returns null for an address below every range', () => {
    const map = new Map<string, CachedCountry>([
      ['US', makeCountry('US', ['10.0.0.0/8'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('9.9.9.9')), null);
  });

  it('matches a /0 catch-all entry', () => {
    const map = new Map<string, CachedCountry>([
      ['XX', makeCountry('XX', ['0.0.0.0/0'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('203.0.113.5')), 'XX');
  });

  it('matches a /32 exact address only', () => {
    const map = new Map<string, CachedCountry>([
      ['XX', makeCountry('XX', ['9.9.9.9/32'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('9.9.9.9')), 'XX');
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('9.9.9.10')), null);
  });

  it('skips malformed CIDRs while building the index', () => {
    const map = new Map<string, CachedCountry>([
      ['XX', makeCountry('XX', ['not-a-cidr', '10.0.0.0/8'])],
    ]);
    const idx = buildLookupIndex(map);
    assert.strictEqual(lookupCountryInIndex(idx, ipNum('10.0.0.1')), 'XX');
  });

  it('returns null on an empty index', () => {
    assert.strictEqual(
      lookupCountryInIndex(buildLookupIndex(new Map()), ipNum('1.2.3.4')),
      null,
    );
  });
});

// --- parseGeoIPBuffer + download integrity ---

// Minimal v2fly geoip.dat protobuf encoder for synthesizing test fixtures.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function encodeVarint(n: number): Buffer {
  const bytes: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** Length-delimited field: tag (field<<3 | 2), varint length, then payload. */
function lenDelim(field: number, payload: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(payload.length),
    payload,
  ]);
}

function cidrMessage(ip: number[], prefix: number): Buffer {
  return Buffer.concat([
    lenDelim(1, Buffer.from(ip)), // field 1: bytes ip
    encodeVarint((2 << 3) | 0), // field 2 tag: uint32 prefix
    encodeVarint(prefix),
  ]);
}

function countryMessage(code: string): Buffer {
  return Buffer.concat([
    lenDelim(1, Buffer.from(code, 'utf-8')), // field 1: iso_code
    lenDelim(2, cidrMessage([192, 168, 1, 0], 24)), // field 2: one CIDR
  ]);
}

/** Two-letter codes so the decoder's length === 2 guard accepts them. */
function countryCode(i: number): string {
  return `${LETTERS[Math.floor(i / 26)]}${LETTERS[i % 26]}`;
}

function geoipListBuffer(countryCount: number): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < countryCount; i++) {
    parts.push(lenDelim(1, countryMessage(countryCode(i))));
  }
  return Buffer.concat(parts);
}

describe('parseGeoIPBuffer', () => {
  it('decodes a synthetic geoip.dat with the expected country count', () => {
    const countries = parseGeoIPBuffer(geoipListBuffer(5));
    assert.strictEqual(countries.size, 5);
    assert.ok(countries.has('AA'));
    assert.ok(countries.has('AE'));
  });

  it('stores decoded CIDRs under each country entry', () => {
    const countries = parseGeoIPBuffer(geoipListBuffer(1));
    const entry = countries.get('AA');
    assert.ok(entry);
    assert.deepStrictEqual(entry.cidrs, ['192.168.1.0/24']);
  });

  it('decodes a large database that exceeds the validation threshold', () => {
    const countries = parseGeoIPBuffer(geoipListBuffer(150));
    assert.strictEqual(countries.size, 150);
    assert.ok(countries.size >= MIN_COUNTRY_COUNT);
  });
});

describe('GeoIP download integrity threshold', () => {
  it('MIN_COUNTRY_COUNT is a sane value below the real DB size', () => {
    assert.ok(MIN_COUNTRY_COUNT > 0 && MIN_COUNTRY_COUNT < 250);
  });

  it('flags a truncated download (too few countries) so the live file is preserved', () => {
    // refresh() rejects a download whose parsed country count is below the
    // threshold. A 5-country buffer models a truncated/corrupt download.
    const countries = parseGeoIPBuffer(geoipListBuffer(5));
    assert.ok(countries.size < MIN_COUNTRY_COUNT);
  });

  it('flags an HTML error page so the live file is preserved', () => {
    // A CDN 200-with-HTML body parses to essentially zero countries.
    const html = Buffer.from(
      '<!DOCTYPE html><html><body>404 Not Found</body></html>'.padEnd(
        2000,
        ' ',
      ),
      'utf-8',
    );
    const countries = parseGeoIPBuffer(html);
    assert.ok(countries.size < MIN_COUNTRY_COUNT);
  });
});

// --- refresh() live-file preservation integration tests ---

/** Append an ignored protobuf field large enough to clear the download size
 *  guard (>= 1000 bytes) without adding any countries. This ensures the
 *  country-count guard (not the size guard) is the layer under test. */
function padPastSizeGuard(buf: Buffer): Buffer {
  const PAD = Buffer.alloc(1100);
  return Buffer.concat([buf, lenDelim(99, PAD)]);
}

/** Build a fetch stub that serves `body` as a 200 octet-stream response.
 *  Wraps in Uint8Array to satisfy the Response BodyInit type (bare Buffer
 *  triggers TS2345 with stricter lib types). */
function fetchServing(body: Buffer): () => Promise<Response> {
  return async () =>
    new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
      },
    });
}

describe('GeoIP refresh() preserves the live file on a bad download', () => {
  const geoipDir = path.join(process.cwd(), 'data', 'geoip');
  const geoipFile = path.join(geoipDir, 'geoip.dat');
  const SENTINEL = 'INTEGRATION-TEST-SENTINEL-ORIGINAL';

  let savedFetch: typeof globalThis.fetch;
  let priorContent: Buffer | null = null;

  before(async () => {
    savedFetch = globalThis.fetch;
    await fs.promises.mkdir(geoipDir, { recursive: true });
    try {
      priorContent = await fs.promises.readFile(geoipFile);
    } catch {
      priorContent = null;
    }
    await fs.promises.writeFile(geoipFile, SENTINEL, 'utf-8');
  });

  after(async () => {
    globalThis.fetch = savedFetch;
    if (priorContent !== null) {
      await fs.promises.writeFile(geoipFile, priorContent);
    } else {
      await fs.promises.rm(geoipFile, { force: true });
    }
  });

  it('does not replace the live file when the download contains too few countries', async () => {
    // 5 countries padded past the size guard so the country-count guard
    // (< MIN_COUNTRY_COUNT) is what rejects this truncated download.
    const tinyBuf = padPastSizeGuard(geoipListBuffer(5));

    globalThis.fetch = fetchServing(tinyBuf);
    const result = await geoIPManager.refresh();

    assert.strictEqual(result.success, false, 'refresh must report failure');
    const liveContent = await fs.promises.readFile(geoipFile, 'utf-8');
    assert.strictEqual(
      liveContent,
      SENTINEL,
      'live GeoIP file must not be replaced when the download fails validation',
    );
  });

  it('does not replace the live file when the download is an HTML error page', async () => {
    // HTML body padded past the size guard; still parses to 0 countries
    // (<! byte triggers wireType-4 break in the protobuf decoder).
    const htmlBuf = padPastSizeGuard(
      Buffer.from(
        '<!DOCTYPE html><html><body>Service Unavailable</body></html>',
        'utf-8',
      ),
    );

    globalThis.fetch = fetchServing(htmlBuf);
    const result = await geoIPManager.refresh();

    assert.strictEqual(result.success, false, 'refresh must report failure');
    const liveContent = await fs.promises.readFile(geoipFile, 'utf-8');
    assert.strictEqual(
      liveContent,
      SENTINEL,
      'live GeoIP file must not be replaced when the download is an HTML error page',
    );
  });
});
