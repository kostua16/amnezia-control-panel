import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCIDR, readVarint, varintSize } from '../geoip-manager';

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
