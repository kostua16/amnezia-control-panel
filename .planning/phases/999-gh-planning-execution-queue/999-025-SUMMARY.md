---
plan: 999-025
phase: 999
status: complete
---

# Summary: Plan 999-025 — migrate middleware to proxy

## What was done

Renamed `src/middleware.ts` to `src/proxy.ts` and renamed the exported function from `middleware` to `proxy` to follow the Next.js proxy convention and eliminate the deprecation warning on `next dev`.

## Changes

| File | Action |
|------|--------|
| `src/proxy.ts` | Created — renamed from middleware.ts with function `proxy` and updated comments |
| `src/middleware.ts` | Deleted |
| `src/app/api/__tests__/middleware.test.ts` | Updated import to `proxy` from `proxy.ts`, updated function calls |
| `.github/workflows/policy.json` | Updated path reference from `src/middleware.ts` to `src/proxy.ts` |

## Key decisions

- Kept test filename as `middleware.test.ts` to minimize diff scope; updated only imports and function calls
- Updated JSDoc comment ("The proxy is the single source of truth") and inline comment ("Skip proxy") to remove all middleware references from proxy.ts
- Left documentation comments in other files (me/route.ts, rollback/route.ts, server.mjs) unchanged as they describe historical context, not import paths

## Self-Check: PASSED

- [x] `src/proxy.ts` exists at expected path
- [x] `src/middleware.ts` deleted
- [x] Zero "middleware" references in `src/proxy.ts`
- [x] All 597 tests pass
- [x] Lint: 0 errors
- [x] Prettier: clean
- [x] Committed as `639d227`
