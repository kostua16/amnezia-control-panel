import type { GeoRoutingRule, GeoTarget } from '@/types/geo-routing';

export interface GeoRoutingResult {
  matched: boolean;
  rule?: GeoRoutingRule;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number;
}

/**
 * Evaluate a destination against geo-routing rules.
 *
 * Rules are evaluated by priority (ascending). First matching rule wins.
 */
export function evaluateGeoRules(
  destination: GeoTarget,
  rules: GeoRoutingRule[],
): GeoRoutingResult {
  // Sort by priority (lower number = higher priority)
  const sorted = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (matchesTarget(destination, rule.target)) {
      return {
        matched: true,
        rule,
        action: rule.action,
        chainId: rule.chainId,
      };
    }
  }

  // Default: allow
  return { matched: false, action: 'ALLOW' };
}

function matchesTarget(
  destination: GeoTarget,
  ruleTarget: GeoTarget,
): boolean {
  // Special targets
  if (ruleTarget.special === 'domestic' && destination.special === 'domestic') {
    return true;
  }
  if (ruleTarget.special === 'foreign' && destination.special === 'foreign') {
    return true;
  }

  // Country code match
  if (ruleTarget.countryCode && destination.countryCode) {
    return ruleTarget.countryCode.toUpperCase() === destination.countryCode.toUpperCase();
  }

  // Region match (substring)
  if (ruleTarget.region && destination.region) {
    return (
      destination.region.toLowerCase() === ruleTarget.region.toLowerCase()
    );
  }

  return false;
}

/**
 * GeoIP lookup stub.
 *
 * In production, integrate with MaxMind GeoIP2 database or a web API
 * (e.g., ip-api.com, ipinfo.io) to resolve IP addresses to country codes.
 */
export async function lookupGeoIP(
  _ip: string,
): Promise<{ countryCode: string | null; region: string | null }> {
  // STUB: Returns null for all lookups.
  // Replace with actual GeoIP integration:
  //
  // const response = await fetch(`https://ip-api.com/json/${ip}?fields=status,countryCode,regionName`);
  // const data = await response.json();
  // if (data.status === 'success') {
  //   return { countryCode: data.countryCode, region: data.regionName };
  // }

  console.log(`[geo-routing] GeoIP lookup stub called for IP: ${_ip}`);
  return { countryCode: null, region: null };
}

/**
 * Classify a destination as domestic or foreign.
 *
 * Uses a configured domestic country code list.
 */
export function classifyDomesticForeign(
  countryCode: string | null,
  domesticCountryCodes: string[],
): 'domestic' | 'foreign' {
  if (!countryCode) return 'foreign';
  return domesticCountryCodes.map((c) => c.toUpperCase()).includes(countryCode.toUpperCase())
    ? 'domestic'
    : 'foreign';
}
