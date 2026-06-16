import type { GeoMatchType } from '@/types/geo-routing';
import type { RuleAction, RuleProtocol } from '@/types/routing';

// ─── Option lists shared across routing UI ───────────────

export const MATCH_TYPE_OPTIONS: { value: GeoMatchType; label: string }[] = [
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'special', label: 'Special' },
];

export const REGION_OPTIONS = [
  'Europe',
  'Asia-Pacific',
  'North America',
  'South America',
  'Africa',
  'Middle East',
];

export const SPECIAL_OPTIONS = [
  { value: 'domestic' as const, label: 'Domestic' },
  { value: 'foreign' as const, label: 'Foreign' },
];

// ALLOW/BLOCK/ROUTE applies to both geo and IP/domain rules.
export const ACTION_OPTIONS: { value: RuleAction; label: string }[] = [
  { value: 'ALLOW', label: 'Allow' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'ROUTE', label: 'Route' },
];

export const PROTOCOL_OPTIONS: { value: RuleProtocol; label: string }[] = [
  { value: 'ANY', label: 'Any' },
  { value: 'WIREGUARD', label: 'WireGuard' },
  { value: 'VLESS', label: 'VLESS' },
  { value: 'VMESS', label: 'VMess' },
  { value: 'TROJAN', label: 'Trojan' },
  { value: 'SHADOWSOCKS', label: 'Shadowsocks' },
];

// ─── Label/style helpers ─────────────────────────────────

export function protocolLabel(protocol: string): string {
  const labels: Record<string, string> = {
    ANY: 'Any',
    WIREGUARD: 'WireGuard',
    VLESS: 'VLESS',
    VMESS: 'VMess',
    TROJAN: 'Trojan',
    SHADOWSOCKS: 'Shadowsocks',
  };
  return labels[protocol] ?? protocol;
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    ALLOW: 'Allow',
    BLOCK: 'Block',
    ROUTE: 'Route',
  };
  return labels[action] ?? action;
}

export function actionStyle(action: string): string {
  switch (action) {
    case 'ALLOW':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'BLOCK':
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
    case 'ROUTE':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
