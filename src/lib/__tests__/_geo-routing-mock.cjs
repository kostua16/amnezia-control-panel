/**
 * Mock module for geo-routing.ts -- used by _setup-geo-routing-mock.cjs
 * to prevent transitive @/lib/prisma import during chain-router tests.
 */
module.exports = {
  resolveGeoRoute: async (_ip) => ({ matched: false, action: 'ALLOW' }),
  evaluateGeoRules: (_dest, _rules) => ({ matched: false, action: 'ALLOW' }),
  lookupGeoIP: async (_ip) => ({ countryCode: null, region: null }),
  classifyDomesticForeign: (_cc, _domestic) => 'foreign',
  evaluateGeoRulesFromDB: async (_dest) => ({
    matched: false,
    action: 'ALLOW',
  }),
};
