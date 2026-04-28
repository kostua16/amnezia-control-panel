export interface GeoTarget {
  /** ISO 3166-1 alpha-2 country code, e.g. 'US', 'DE', 'RU' */
  countryCode?: string;
  /** Region name (e.g. 'Europe', 'Asia-Pacific') */
  region?: string;
  /** Special target: 'domestic' or 'foreign' */
  special?: 'domestic' | 'foreign';
}

export interface GeoRoutingRule {
  id: number;
  name: string;
  target: GeoTarget;
  /** What to do with matching traffic */
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  /** Chain ID to route through (only if action === 'ROUTE') */
  chainId?: number;
  /** Rule priority (lower = higher priority) */
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GeoRuleCreate {
  name: string;
  target: GeoTarget;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number;
  priority?: number;
  isActive?: boolean;
}

export interface GeoRuleUpdate {
  name?: string;
  target?: GeoTarget;
  action?: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority?: number;
  isActive?: boolean;
}
