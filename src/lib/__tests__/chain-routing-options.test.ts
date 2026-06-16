import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoutingOptionsForTopology,
  getInvalidDirectGeoipTags,
  hasDirectGeoipTags,
  normalizeDirectGeoipTagsInput,
  parseDirectGeoipTagsInput,
} from '../chain-routing-options';

describe('normalizeDirectGeoipTagsInput', () => {
  it('normalizes case, spacing, duplicates, and private', () => {
    assert.deepEqual(normalizeDirectGeoipTagsInput(' KZ, de, kz, private '), {
      validTags: ['kz', 'de'],
      invalidTags: [],
    });
  });

  it('reports invalid tags without counting them as valid', () => {
    assert.deepEqual(normalizeDirectGeoipTagsInput('r u, ru!, kz'), {
      validTags: ['kz'],
      invalidTags: ['r u', 'ru!'],
    });
  });

  it('does not enable split routing for invalid-only input', () => {
    assert.equal(hasDirectGeoipTags('r u'), false);
    assert.deepEqual(parseDirectGeoipTagsInput('r u'), []);
    assert.deepEqual(getInvalidDirectGeoipTags('r u'), ['r u']);
  });

  it('builds split routing options only from valid tags', () => {
    assert.deepEqual(buildRoutingOptionsForTopology('split', 'KZ, private'), {
      split: { directGeoipTags: ['kz'] },
    });
    assert.equal(buildRoutingOptionsForTopology('linear', 'kz'), undefined);
  });

  it('does not silently submit mixed invalid input', () => {
    assert.equal(hasDirectGeoipTags('kz, r u'), false);
    assert.throws(
      () => buildRoutingOptionsForTopology('split', 'kz, r u'),
      /Invalid split GeoIP zone tag: r u/,
    );
  });
});
