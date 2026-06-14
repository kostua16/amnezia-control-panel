---
phase: 999
plan: 999-006
status: complete
started: "2026-06-14T00:00:00Z"
updated: "2026-06-14T00:00:00Z"
---

# Summary: Fix CI build failure and harden perf-check diagnostics

## What was done

Investigated all failed checks on PR #380. Found only the Performance Check
actually failed (`npm run build` exit 1); other red marks (PR Orchestrator,
Antigravity, DeepSeek) were `cancelled` by `cancel-in-progress` concurrency,
not real failures.

Reproduced the build error locally (the perf-check workflow swallowed it into
a temp file with no re-emission). The root cause was a type-narrowing mismatch
in the DI refactor: `ChainRouterServicePortLookup.service.findFirst` used bare
`string` for `where.type`, but Prisma's generated `findFirst` expects
`ServiceType` (enum). Under contravariant parameter checking, `string` is not
assignable to `ServiceType | EnumServiceTypeFilter`.

### Changes

| File | Change |
|------|--------|
| `src/lib/chain-router.ts` | Import `ServiceType` from `@/generated/prisma/enums` and use it in `ChainRouterServicePortLookup` instead of bare `string` |
| `.github/workflows/perf-check.yml` | On build failure, emit last 40 lines via `::error::` annotation + tail so the error is visible in CI logs and Actions annotations |

## Key files

### key-files.modified
- `src/lib/chain-router.ts` — Fixed `ChainRouterServicePortLookup.where.type` from `string` to `ServiceType` (imported from `@/generated/prisma/enums`)
- `.github/workflows/perf-check.yml` — Build step now re-emits output on failure instead of silently swallowing to `/tmp`

## Self-Check: PASSED

- `npm run build`: compiles successfully (type error resolved)
- `npm run lint`: no issues
- `npm test`: 490 pass, 0 fail
- Prettier: all files formatted
