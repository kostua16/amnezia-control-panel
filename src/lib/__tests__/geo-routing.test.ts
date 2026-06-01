import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGeoRules,
  classifyDomesticForeign,
} from '../geo-routing';
import type { GeoRoutingRule } from '@/types/geo-routing';

function makeRule(overrides: Partial<GeoRoutingRule> = {}): GeoRoutingRule {
  return {
    id: 1,
    name: 'Test Rule',
    matchType: 'country',
    target: { countryCode: 'US' },
    action: 'BLOCK',
    priority: 1,
    isActive: true,
    source: 'custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('evaluateGeoRules', () => {
  it('returns default ALLOW when no rules match', () => {
    const result = evaluateGeoRules({ countryCode: 'DE' }, []);
    assert.equal(result.matched, false);
    assert.equal(result.action, 'ALLOW');
  });

  it('matches a country code rule and returns its action', () => {
    const rule = makeRule({
      target: { countryCode: 'US' },
      action: 'BLOCK',
      priority: 1,
    });
    const result = evaluateGeoRules({ countryCode: 'US' }, [rule]);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'BLOCK');
    assert.equal(result.rule?.id, 1);
  });

  it('skips inactive rules', () => {
    const rule = makeRule({
      target: { countryCode: 'US' },
      action: 'BLOCK',
      isActive: false,
    });
    const result = evaluateGeoRules({ countryCode: 'US' }, [rule]);
    assert.equal(result.matched, false);
    assert.equal(result.action, 'ALLOW');
  });

  it('respects priority ordering — lower number wins', () => {
    const rules = [
      makeRule({
        id: 2,
        target: { countryCode: 'US' },
        action: 'ROUTE',
        chainId: 5,
        priority: 10,
      }),
      makeRule({
        id: 1,
        target: { countryCode: 'US' },
        action: 'BLOCK',
        priority: 1,
      }),
    ];
    const result = evaluateGeoRules({ countryCode: 'US' }, rules);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'BLOCK');
    assert.equal(result.rule?.id, 1);
  });

  it('matches domestic special target', () => {
    const rule = makeRule({
      target: { special: 'domestic' },
      action: 'ALLOW',
      priority: 1,
    });
    const result = evaluateGeoRules({ special: 'domestic' }, [rule]);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'ALLOW');
  });

  it('does not match domestic against foreign', () => {
    const rule = makeRule({
      target: { special: 'domestic' },
      action: 'BLOCK',
      priority: 1,
    });
    const result = evaluateGeoRules({ special: 'foreign' }, [rule]);
    assert.equal(result.matched, false);
    assert.equal(result.action, 'ALLOW');
  });

  it('matches foreign special target', () => {
    const rule = makeRule({
      target: { special: 'foreign' },
      action: 'BLOCK',
      priority: 1,
    });
    const result = evaluateGeoRules({ special: 'foreign' }, [rule]);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'BLOCK');
  });

  it('matches region (case-insensitive)', () => {
    const rule = makeRule({
      target: { region: 'California' },
      action: 'ROUTE',
      chainId: 3,
      priority: 1,
    });
    const result = evaluateGeoRules({ region: 'california' }, [rule]);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'ROUTE');
    assert.equal(result.chainId, 3);
  });

  it('ROUTE action includes chainId', () => {
    const rule = makeRule({
      target: { countryCode: 'CN' },
      action: 'ROUTE',
      chainId: 42,
      priority: 1,
    });
    const result = evaluateGeoRules({ countryCode: 'CN' }, [rule]);
    assert.equal(result.matched, true);
    assert.equal(result.action, 'ROUTE');
    assert.equal(result.chainId, 42);
  });

  it('country code matching is case-insensitive', () => {
    const rule = makeRule({
      target: { countryCode: 'us' },
      action: 'BLOCK',
      priority: 1,
    });
    const result = evaluateGeoRules({ countryCode: 'US' }, [rule]);
    assert.equal(result.matched, true);
  });
});

describe('classifyDomesticForeign', () => {
  it('returns domestic when country is in the list', () => {
    assert.equal(classifyDomesticForeign('US', ['US', 'CA']), 'domestic');
  });

  it('returns foreign when country is not in the list', () => {
    assert.equal(classifyDomesticForeign('DE', ['US', 'CA']), 'foreign');
  });

  it('returns foreign when country code is null', () => {
    assert.equal(classifyDomesticForeign(null, ['US']), 'foreign');
  });

  it('comparison is case-insensitive', () => {
    assert.equal(classifyDomesticForeign('us', ['US', 'CA']), 'domestic');
    assert.equal(classifyDomesticForeign('US', ['us', 'ca']), 'domestic');
  });

  it('returns foreign for empty domestic list', () => {
    assert.equal(classifyDomesticForeign('US', []), 'foreign');
  });
});
