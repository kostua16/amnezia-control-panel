# Quick Task 260604-j9k: GeoIP lookup — O(n) linear scan → indexed radix lookup

## Problem

`src/lib/geoip-manager.ts:350-371` — `lookupCountry()` iterates **every country × every CIDR** for each IP lookup:

```ts
for (const [, country] of this.countries) {
  for (const cidr of country.cidrs) {
    if (matchesCIDR(ipNum, cidr)) {
      return country.countryCode;
    }
  }
}
```

The v2fly `geoip.dat` file contains ~250 countries with tens of thousands of CIDR ranges. Every lookup is O(total-CIDR-ranges). At 1-3 servers with up to 50 users, the volume is low today, but geo-routing (`src/lib/geo-routing.ts:143`) calls `lookupGeoIP` per connection — a burst of concurrent connections creates a visible CPU spike.

The parsed CIDR data is stored as strings (`"192.168.0.0/16"`), forcing `matchesCIDR()` to re-parse the IP and prefix on every comparison.

## Scope

### 1. Build an integer-sorted CIDR table at parse time
- **files**: `src/lib/geoip-manager.ts`
- **action**:
  - During `decodeGeoIPProtobufIntoCountries()`, store CIDRs as `{ network: number, mask: number, countryCode: string }` tuples instead of string arrays.
  - After parsing, sort the flat array by network address.
  - Replace the nested loop with a binary search for the IP's position, then check surrounding entries for mask match.
- **verify**: Unit test: lookup for known IPs (e.g. `8.8.8.8` → `US`) returns correct country; performance benchmark shows <1ms per lookup.
- **done**: `lookupCountry()` uses binary search over pre-sorted integer CIDR table.

### 2. Remove string-based CIDR matching
- **files**: `src/lib/geoip-manager.ts`
- **action**:
  - Remove `matchesCIDR()` function (currently re-parses `"a.b.c.d/p"` string on every call).
  - `CachedCountry.cidrs` becomes unnecessary once CIDRs are stored in the flat table.
- **verify**: No references to `matchesCIDR`; all tests pass.
- **done**: Zero string-based CIDR parsing at lookup time.

## Acceptance Criteria
- [ ] `lookupCountry()` completes in <1ms for any IPv4 address
- [ ] No string parsing occurs on the lookup hot path
- [ ] Existing geo-routing behavior unchanged (same country results)

## Risk
- Low — data structure change is internal to `GeoIPManager`; public API (`lookupGeoIP`, `getGeoIPStatus`, `refreshGeoIP`) unchanged.

## Estimated Effort
1 focused session
