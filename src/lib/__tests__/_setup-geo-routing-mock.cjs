/**
 * Preload script: redirects geo-routing imports to a mock module.
 *
 * This prevents the transitive import chain:
 *   chain-router.test.ts -> chain-router.ts -> geo-routing.ts -> prisma.ts -> @/generated/prisma/client
 *
 * Usage: node --import tsx --require ./src/lib/__tests__/_setup-geo-routing-mock.cjs --test src/lib/__tests__/chain-router.test.ts
 *
 * The mock returns { matched: false, action: 'ALLOW' } for all geo-route lookups,
 * matching the default fail-open behavior of resolveGeoRoute.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
const originalResolveFilename = Module._resolveFilename;

// Exports are defined but not used — this is intentional for the mock module
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const geoRoutingMockExports = {
  resolveGeoRoute: async (_ip) => ({ matched: false, action: 'ALLOW' }),
  evaluateGeoRules: (_dest, _rules) => ({ matched: false, action: 'ALLOW' }),
  lookupGeoIP: async (_ip) => ({ countryCode: null, region: null }),
  classifyDomesticForeign: (_cc, _domestic) => 'foreign',
  evaluateGeoRulesFromDB: async (_dest) => ({
    matched: false,
    action: 'ALLOW',
  }),
};

Module._resolveFilename = function (request, parent, ...args) {
  // Match geo-routing relative imports from chain-router
  if (
    parent &&
    typeof request === 'string' &&
    (request === '../geo-routing' ||
      request === './geo-routing' ||
      request.endsWith('/geo-routing') ||
      request.endsWith('/geo-routing.ts'))
  ) {
    // Check if the parent is chain-router or chain-router.test
    const parentFile = parent.filename || '';
    if (
      parentFile.includes('chain-router') ||
      parentFile.includes('chain-router.test')
    ) {
      const mockPath = path.resolve(__dirname, '_geo-routing-mock.cjs');
      return originalResolveFilename.call(this, mockPath, parent, ...args);
    }
  }
  return originalResolveFilename.call(this, request, parent, ...args);
};
