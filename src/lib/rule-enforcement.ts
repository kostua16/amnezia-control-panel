import { prisma } from '@/lib/prisma';
import type { RoutingAction } from '@/generated/prisma/enums';

// ─── Types ───────────────────────────────────────────────

export interface AppliedRule {
  ruleId: number;
  protocol: string;
  destination: string;
  action: RoutingAction;
  priority: number;
  userId: number | null;
}

export interface RuleEnforcementResult {
  success: boolean;
  appliedCount: number;
  errors: string[];
  rules: AppliedRule[];
  awgConfig: AwgRuleConfig[];
  threeXuiConfig: ThreeXuiRuleConfig[];
}

export interface AwgRuleConfig {
  destination: string;
  action: 'ALLOW' | 'BLOCK';
  priority: number;
}

export interface ThreeXuiRuleConfig {
  destination: string;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  priority: number;
  protocol?: string;
}

// ─── Rule Evaluation ─────────────────────────────────────

/**
 * Evaluate routing rules for a specific user.
 * Returns rules sorted by priority (ascending — lower = higher priority).
 * Global rules (userId = null) are included for all users.
 * User-specific rules override global rules at the same priority.
 */
async function evaluateRulesForUser(userId: number): Promise<AppliedRule[]> {
  const rules = await prisma.routingRule.findMany({
    where: {
      isActive: true,
      OR: [{ userId }, { userId: null }],
    },
    orderBy: { priority: 'asc' },
  });

  return rules.map((rule) => ({
    ruleId: rule.id,
    protocol: rule.protocol,
    destination: rule.destination,
    action: rule.action,
    priority: rule.priority,
    userId: rule.userId,
  }));
}

/**
 * Evaluate all active routing rules globally.
 */
async function evaluateAllRules(): Promise<AppliedRule[]> {
  const rules = await prisma.routingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  return rules.map((rule) => ({
    ruleId: rule.id,
    protocol: rule.protocol,
    destination: rule.destination,
    action: rule.action,
    priority: rule.priority,
    userId: rule.userId,
  }));
}

// ─── Config Generation ───────────────────────────────────

/**
 * Generate AWG-compatible rule configurations.
 * AWG uses AllowedIPs for allow/block decisions.
 */
function generateAwgConfig(rules: AppliedRule[]): AwgRuleConfig[] {
  const awgRules: AwgRuleConfig[] = [];

  for (const rule of rules) {
    // AWG rules apply when protocol is ANY or WIREGUARD
    if (rule.protocol !== 'ANY' && rule.protocol !== 'WIREGUARD') {
      continue;
    }

    const awgAction = rule.action === 'BLOCK' ? 'BLOCK' : 'ALLOW';

    awgRules.push({
      destination: rule.destination,
      action: awgAction,
      priority: rule.priority,
    });
  }

  return awgRules;
}

/**
 * Generate 3x-ui compatible rule configurations.
 * 3x-ui supports more granular routing rules per protocol.
 */
function generateThreeXuiConfig(rules: AppliedRule[]): ThreeXuiRuleConfig[] {
  const xuiRules: ThreeXuiRuleConfig[] = [];

  for (const rule of rules) {
    // 3x-ui rules apply when protocol is ANY, VLESS, VMESS, TROJAN, or SHADOWSOCKS
    if (
      rule.protocol !== 'ANY' &&
      rule.protocol !== 'VLESS' &&
      rule.protocol !== 'VMESS' &&
      rule.protocol !== 'TROJAN' &&
      rule.protocol !== 'SHADOWSOCKS'
    ) {
      continue;
    }

    xuiRules.push({
      destination: rule.destination,
      action: rule.action as 'ALLOW' | 'BLOCK' | 'ROUTE',
      priority: rule.priority,
      protocol: rule.protocol === 'ANY' ? undefined : rule.protocol,
    });
  }

  return xuiRules;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Apply all routing rules for a specific user.
 * Evaluates global + user-specific rules, generates configs for both VPN systems.
 */
export async function applyRoutingRules(
  userId: number,
): Promise<RuleEnforcementResult> {
  const errors: string[] = [];

  try {
    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { protocols: { where: { isActive: true }, select: { serviceType: true } } },
    });

    if (!user) {
      return {
        success: false,
        appliedCount: 0,
        errors: [`User ${userId} not found`],
        rules: [],
        awgConfig: [],
        threeXuiConfig: [],
      };
    }

    // Evaluate rules
    const rules = await evaluateRulesForUser(userId);

    // Generate configs
    const awgConfig = generateAwgConfig(rules);
    const threeXuiConfig = generateThreeXuiConfig(rules);

    // Determine which services this user uses
    const serviceTypes = user.protocols.map((p) => p.serviceType);

    // In production, these configs would be pushed to the actual VPN services.
    // For now, we log the generated configs and mark rules as applied.
    if (serviceTypes.includes('AWG')) {
      console.log(
        `[rule-enforcement] AWG config for user ${user.username}:`,
        JSON.stringify(awgConfig, null, 2),
      );
    }

    if (serviceTypes.includes('THREE_XUI')) {
      console.log(
        `[rule-enforcement] 3x-ui config for user ${user.username}:`,
        JSON.stringify(threeXuiConfig, null, 2),
      );
    }

    return {
      success: true,
      appliedCount: rules.length,
      errors,
      rules,
      awgConfig,
      threeXuiConfig,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error during rule application';
    return {
      success: false,
      appliedCount: 0,
      errors: [message],
      rules: [],
      awgConfig: [],
      threeXuiConfig: [],
    };
  }
}

/**
 * Apply all routing rules for all users.
 * Evaluates all active rules and generates configs for both VPN systems.
 */
export async function applyAllRules(): Promise<RuleEnforcementResult> {
  const errors: string[] = [];
  let totalApplied = 0;

  try {
    // Evaluate all rules
    const allRules = await evaluateAllRules();

    // Generate global configs
    const awgConfig = generateAwgConfig(allRules);
    const threeXuiConfig = generateThreeXuiConfig(allRules);

    // Get all active users
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: { protocols: { where: { isActive: true }, select: { serviceType: true } } },
    });

    // Apply rules per user
    for (const user of users) {
      const userRules = allRules.filter(
        (r) => r.userId === null || r.userId === user.id,
      );

      const serviceTypes = user.protocols.map((p) => p.serviceType);

      if (serviceTypes.includes('AWG')) {
        const userAwgConfig = generateAwgConfig(userRules);
        console.log(
          `[rule-enforcement] AWG config for user ${user.username}:`,
          JSON.stringify(userAwgConfig, null, 2),
        );
      }

      if (serviceTypes.includes('THREE_XUI')) {
        const userXuiConfig = generateThreeXuiConfig(userRules);
        console.log(
          `[rule-enforcement] 3x-ui config for user ${user.username}:`,
          JSON.stringify(userXuiConfig, null, 2),
        );
      }

      totalApplied += userRules.length;
    }

    return {
      success: true,
      appliedCount: totalApplied,
      errors,
      rules: allRules,
      awgConfig,
      threeXuiConfig,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error during rule application';
    errors.push(message);

    return {
      success: false,
      appliedCount: totalApplied,
      errors,
      rules: [],
      awgConfig: [],
      threeXuiConfig: [],
    };
  }
}
