import { prisma } from '@/lib/prisma';
import type { GeoRoutingRule, GeoTarget } from '@/types/geo-routing';
import { lookupGeoIP as geoIPLookup } from '@/lib/geoip-manager';

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
        chainId: rule.chainId ?? undefined,
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
 * GeoIP lookup -- delegates to GeoIPManager (v2fly geoip.dat).
 * Per D-04: fail open -- returns null on any error.
 * Per D-06: IPv4 only -- returns null for IPv6.
 */
export async function lookupGeoIP(
  ip: string,
): Promise<{ countryCode: string | null; region: string | null }> {
  return geoIPLookup(ip);
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

/**
 * Evaluate a destination against all active geo-routing rules in the database.
 * Per D-08: SQLite is canonical; this function reads directly from DB.
 *
 * Rules are evaluated by priority (ascending). First matching rule wins.
 * Per D-04: if no rules match, returns default ALLOW (fail open).
 */
export async function evaluateGeoRulesFromDB(
  destination: GeoTarget,
): Promise<GeoRoutingResult> {
  const rules = await prisma.geoRoutingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  // Map DB rows to GeoRoutingRule type
  const typedRules: GeoRoutingRule[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    matchType: r.matchType as GeoRoutingRule['matchType'],
    target: {
      countryCode: r.countryCode ?? undefined,
      region: r.region ?? undefined,
      special: r.special as GeoRoutingRule['target']['special'] ?? undefined,
    },
    action: r.action as 'ALLOW' | 'BLOCK' | 'ROUTE',
    chainId: r.chainId ?? undefined,
    priority: r.priority,
    isActive: r.isActive,
    source: r.source as GeoRoutingRule['source'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return evaluateGeoRules(destination, typedRules);
}

/**
 * Resolve a destination IP to a geo-routing decision.
 *
 * 1. Look up IP -> country code via GeoIP
 * 2. Evaluate against active geo rules
 * 3. Return routing decision (action + optional chainId)
 *
 * Per D-04: fail open on any error.
 * Per D-06: IPv4 only.
 */
export async function resolveGeoRoute(
  ip: string,
): Promise<GeoRoutingResult> {
  try {
    const { countryCode } = await lookupGeoIP(ip);

    if (!countryCode) {
      return { matched: false, action: 'ALLOW' };
    }

    return evaluateGeoRulesFromDB({ countryCode });
  } catch (err) {
    // Per D-04: fail open
    console.error('[geo-routing] resolveGeoRoute error:', err);
    return { matched: false, action: 'ALLOW' };
  }
}
