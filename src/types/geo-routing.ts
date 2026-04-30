/** Match type for geo-routing rules */
export type GeoMatchType = 'country' | 'region' | 'special';

/** Source of a geo-routing rule */
export type GeoRuleSource = 'custom' | 'imported' | 'template';

export interface GeoTarget {
  countryCode?: string;
  region?: string;
  special?: 'domestic' | 'foreign';
}

export interface GeoRoutingRule {
  id: number;
  name: string;
  matchType: GeoMatchType;
  target: GeoTarget;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority: number;
  isActive: boolean;
  source: GeoRuleSource;
  createdAt: string;
  updatedAt: string;
}

export interface GeoRuleCreate {
  name: string;
  matchType: GeoMatchType;
  target: GeoTarget;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority?: number;
  isActive?: boolean;
  source?: GeoRuleSource;
}

export interface GeoRuleUpdate {
  name?: string;
  matchType?: GeoMatchType;
  target?: GeoTarget;
  action?: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number | null;
  priority?: number;
  isActive?: boolean;
}

export interface GeoRoutingResult {
  matched: boolean;
  rule?: GeoRoutingRule;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number;
}
