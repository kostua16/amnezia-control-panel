---
plan: 999-039
phase: 999
status: complete
---

# Plan 999-039 Summary: Batch server lookups in panel-sync push

## What Changed

`pushConfigToAllPanels()` in `src/lib/panel-sync-client.ts` previously ran a per-panel `prisma.server.findFirst()` inside the panel iteration loop — N+1 DB queries for N panels.

Refactored to fetch all servers in a single `findMany` before the loop and resolve lookups in memory via a `findServerByHost` helper that preserves Prisma's `hostname: { contains }` + `tailnetIP: { equals }` match semantics.

## Key Decisions

- **`Promise.all` for the two initial queries** — panels and servers fetched concurrently since they're independent.
- **`findServerByHost` preserves original match ordering** — exact tailnetIP match checked first, then substring hostname match, mirroring Prisma's `OR` with `findFirst`.
- **Null-safe cast for `resolvePanelTransport`** — `ServerRecord.hostname` is `string | null` per Prisma schema, but `resolvePanelTransport` requires non-null. Added runtime null guard + type assertion after the check.

## Files Modified

- `src/lib/panel-sync-client.ts` — batch server fetch, `findServerByHost` helper, removed per-panel DB query

## Files Unchanged

- `src/lib/__tests__/panel-sync-client.test.ts` — no changes needed; existing tests cover `pushConfigToPanel` and `generatePerPanelConfig` but not the DB-integrated `pushConfigToAllPanels` directly

## Verification

- `npm test` — typecheck ✓, unit tests ✓, lint ✓ (0 errors, 4 pre-existing warnings), prettier ✓
- Commit: `62eed1f`

## Self-Check: PASSED
