---
created: 2026-06-10T23:09:29.203Z
title: Wire importFromRulite() into routing import API
area: api
files:
  - src/lib/routing-rule-templates.ts
  - src/app/api/routing/import/route.ts
---

## Problem

GEO-04 gap: `importFromRulite()` is implemented in `src/lib/routing-rule-templates.ts` but is NOT called anywhere. The `/api/routing/import` route only calls `importFromGeoIPDat()`. There is no repo download path or format detection to route `.rulite` files to the parser. The commit claimed "close GEO-04 gap" but the feature is not wired.

## Solution

1. Add format detection in the import route (check file extension or content header).
2. Route `.rulite` files to `importFromRulite()`.
3. Add a download path for the rulite source repository (similar to geoip.dat download).
4. Wire the parser into the existing import flow so users can actually use it.
