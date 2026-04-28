export type RuleAction = 'ALLOW' | 'BLOCK' | 'ROUTE';
export type RuleProtocol =
  | 'ANY'
  | 'WIREGUARD'
  | 'VLESS'
  | 'VMESS'
  | 'TROJAN'
  | 'SHADOWSOCKS';

export interface RoutingRule {
  id: number;
  protocol: RuleProtocol;
  destination: string;
  action: RuleAction;
  priority: number;
  isActive: boolean;
  userId: number | null;
  createdAt: string;
}

export interface RoutingRuleCreate {
  protocol: RuleProtocol;
  destination: string;
  action: RuleAction;
  priority?: number;
  isActive?: boolean;
  userId?: number | null;
}

export interface RoutingRuleUpdate {
  protocol?: RuleProtocol;
  destination?: string;
  action?: RuleAction;
  priority?: number;
  isActive?: boolean;
  userId?: number | null;
}

export interface ReorderPair {
  id: number;
  priority: number;
}
