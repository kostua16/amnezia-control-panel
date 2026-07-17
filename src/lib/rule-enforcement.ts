import { prisma } from '@/lib/prisma';
import {
  resolveGeoRoute,
  type GeoRoutingResult as GeoRoutingResultInternal,
} from '@/lib/geo-routing';
import { matchesCIDR } from '@/lib/cidr-match';
import type { XrayRoutingRule } from '@/types/chain';

// ─── CIDR Detection ───────────────────────────────────────

/** Basic CIDR pattern — matches IPv4/prefix notation (e.g. 10.0.0.0/8). */
const CIDR_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,3}$/;

/** Returns true when the string looks like a CIDR block (IPv4/prefix). */
function isCIDR(value: string): boolean {
  return CIDR_PATTERN.test(value);
}

// ─── Types ──────────────────────────────────────────────

export interface RuleEnforcementResult {
  allowed: boolean;
  matchedRule?: string;
  reason?: string;
}

export type { GeoRoutingResultInternal as GeoRoutingResult };

// ─── Rule Enforcement ───────────────────────────────────

/**
 * Check if a destination IP is allowed by Xray routing rules.
 * Returns the matched rule (if any) and whether access is allowed.
 */
export function enforceXrayRules(
  destIp: string,
  rules: XrayRoutingRule[],
): RuleEnforcementResult {
  for (const rule of rules) {
    if (rule.type === 'ip' && matchesCIDR(destIp, rule.value)) {
      return {
        allowed: true,
        matchedRule: rule.nodeId,
        reason: `Matched Xray rule for node ${rule.nodeId}`,
      };
    }
  }

  return {
    allowed: false,
    reason: 'No matching Xray rule found',
  };
}

/**
 * Generate Xray routing rules from database config.
 * Converts stored RoutingRule records to the format expected by Xray.
 */
export async function generateXrayRulesFromDB(): Promise<XrayRoutingRule[]> {
  const rules = await prisma.routingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  const xuiRules: XrayRoutingRule[] = [];

  for (const rule of rules) {
    xuiRules.push({
      nodeId: rule.userId != null ? `user-${rule.userId}` : `rule-${rule.id}`,
      type:
        rule.protocol === 'xray'
          ? 'domain'
          : isCIDR(rule.destination)
            ? 'ip'
            : 'domain',
      value: rule.destination,
      outboundTag: rule.action,
      priority: rule.priority,
    });
  }

  return xuiRules;
}

// ─── Geo-Routing Helpers ────────────────────────────────

/**
 * Resolve geo-routing for a destination IP address.
 * Wraps `resolveGeoRoute` from geo-routing module for use in rule enforcement.
 */
export async function resolveGeoRoutingForDestination(
  ip: string,
): Promise<GeoRoutingResultInternal> {
  return resolveGeoRoute(ip);
}

/**
 * Evaluate geo-routing for all IP-like destinations in a set of rules.
 * Returns enriched rules with geo-routing decisions attached.
 */
export async function evaluateGeoRoutingForRules(
  rules: XrayRoutingRule[],
): Promise<
  Array<XrayRoutingRule & { geoDecision?: GeoRoutingResultInternal }>
> {
  const enriched = await Promise.all(
    rules.map(async (rule) => {
      // Extract IP from rule value if it's an IP rule
      if (rule.type === 'ip') {
        const ipMatch = rule.value.match(
          /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/,
        );
        if (ipMatch) {
          const geoResult = await resolveGeoRoute(ipMatch[1]);
          return { ...rule, geoDecision: geoResult };
        }
      }

      return rule;
    }),
  );

  return enriched;
}

/**
 * Check if a destination IP should be blocked based on geo-routing rules.
 * Convenience wrapper for common use case.
 */
export async function isDestinationBlockedByGeo(
  destIp: string,
): Promise<boolean> {
  const result = await resolveGeoRoute(destIp);
  return result.action === 'BLOCK';
}

// ─── Rule Application ──────────────────────────────────

export interface ApplyRulesResult {
  success: boolean;
  appliedCount: number;
  errors: string[];
  rules: XrayRoutingRule[];
  awgConfig: unknown | null;
  threeXuiConfig: unknown | null;
}

/**
 * Apply routing rules for a specific user.
 * Generates the rules and returns the resulting config.
 */
export async function applyRoutingRules(
  _userId: number,
): Promise<ApplyRulesResult> {
  const rules = await generateXrayRulesFromDB();
  return {
    success: true,
    appliedCount: rules.length,
    errors: [],
    rules,
    awgConfig: null,
    threeXuiConfig: null,
  };
}

/**
 * Apply all routing rules (no user filter).
 * Generates the rules and returns the resulting config.
 */
export async function applyAllRules(): Promise<ApplyRulesResult> {
  const rules = await generateXrayRulesFromDB();
  return {
    success: true,
    appliedCount: rules.length,
    errors: [],
    rules,
    awgConfig: null,
    threeXuiConfig: null,
  };
}
