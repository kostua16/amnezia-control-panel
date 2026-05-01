import type { GeoRuleCreate } from '@/types/geo-routing';

/** Default rules inserted by "Load Starter Rules" (ordered by priority). */
export const GEO_STARTER_RULES: GeoRuleCreate[] = [
  {
    name: 'Domestic — allow (starter)',
    matchType: 'special',
    target: { special: 'domestic' },
    action: 'ALLOW',
    priority: 0,
    isActive: true,
    source: 'template',
  },
  {
    name: 'Foreign — allow (starter)',
    matchType: 'special',
    target: { special: 'foreign' },
    action: 'ALLOW',
    priority: 1,
    isActive: true,
    source: 'template',
  },
];
