/**
 * Pure-IPv4 CIDR subnet matching without external dependencies.
 * Returns true when `ip` belongs to the network described by `cidr`.
 *
 * Only handles IPv4 dotted-decimal addresses and /0–/32 masks.
 * Returns false for malformed input or IPv6 addresses.
 */
export function matchesCIDR(ip: string, cidr: string): boolean {
  const slashIndex = cidr.indexOf('/');
  if (slashIndex === -1) return false;

  const networkStr = cidr.slice(0, slashIndex);
  const prefixLen = Number.parseInt(cidr.slice(slashIndex + 1), 10);
  if (prefixLen < 0 || prefixLen > 32) return false;

  const ipNum = parseIPv4(ip);
  const netNum = parseIPv4(networkStr);
  if (ipNum === null || netNum === null) return false;

  if (prefixLen === 0) return true;
  if (prefixLen === 32) return ipNum === netNum;

  // Create a mask with `prefixLen` high bits set
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/** Parse an IPv4 dotted-decimal string to a 32-bit unsigned integer, or null. */
function parseIPv4(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}
