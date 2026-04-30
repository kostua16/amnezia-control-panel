export interface RoutingRuleTemplate {
  id: number;
  name: string;
  description: string;
  category: 'geo' | 'ip' | 'domain' | 'bundle';
  ruleCount: number;
  isBuiltIn: boolean;
  rules: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutingRuleTemplateCreate {
  name: string;
  description?: string;
  category?: 'geo' | 'ip' | 'domain' | 'bundle';
  rules: unknown[];
  isBuiltIn?: boolean;
}
