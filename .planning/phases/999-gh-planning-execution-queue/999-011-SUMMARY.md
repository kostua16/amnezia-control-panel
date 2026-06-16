---
phase: 999-gh-planning-execution-queue
plan: "011"
subsystem: security
tags: [websocket, socket.io, jwt, jose, react-query, sync, hmac, cache-invalidation]

requires: []
provides:
  - "Authenticated Socket.IO handshake (io.use JWT gate) + hardened WS CORS"
  - "Sync-receive freshness + monotonic configVersion replay guards"
  - "User CRUD mutation hooks with React Query cache invalidation"
affects: [realtime, panel-sync, users-ui]

tech-stack:
  added: []
  patterns:
    - "io.use() handshake authenticates the WS channel with the same auth-token cookie/JWT as HTTP middleware"
    - "Mutation hooks invalidate by a shared USERS_QUERY_KEY prefix instead of raw fetch + manual refetch"

key-files:
  created: []
  modified:
    - server.mjs
    - src/middleware.ts
    - src/hooks/use-websocket.ts
    - src/app/api/sync/receive/route.ts
    - src/app/api/__tests__/sync-receive.test.ts
    - src/hooks/use-users.ts
    - src/components/users/create-user-modal.tsx
    - src/components/users/edit-user-modal.tsx
    - src/components/users/user-quota-modal.tsx
    - src/components/users/user-list.tsx

key-decisions:
  - "Socket handshake reuses the existing auth-token cookie/JWT (parsed manually from the raw Cookie header — no cookie-parser) and jose jwtVerify, so no new auth surface is introduced."
  - "Production WS CORS is restricted to NEXT_PUBLIC_APP_URL/APP_URL and never falls back to a wildcard; same-origin needs no ACAO header, so an unset production allowlist disables CORS rather than opening it."
  - "Sync freshness is enforced only when generatedAt parses to a real timestamp (schema allows a min(1) non-ISO fallback); monotonic guard returns idempotent-style 200 so legitimate retries are no-ops."
  - "User mutation hooks invalidate the shared ['users'] prefix; the two single-record GET reads in edit/quota modals were intentionally left as raw fetch (the proposal targets mutation cache invalidation, not reads)."

patterns-established:
  - "Pattern: server-side socket auth via io.use + manual cookie read (server.mjs readCookie)."
  - "Pattern: mutation hooks + shared query-key prefix for cache invalidation (use-users.ts USERS_QUERY_KEY)."

requirements-completed: []

duration: ~35min
completed: 2026-06-16
---

# Plan 999-011: Architectural Review Pass 5 Summary

**Authenticated the Socket.IO realtime channel with a JWT handshake, added sync-replay freshness/monotonic guards, and centralized user CRUD behind cache-invalidating mutation hooks.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 proposals (P13, P14, P15)
- **Files modified:** 10

## Verification

- `npm test` (typecheck + unit tests + lint + prettier): **PASS**
  - Typecheck: clean
  - Unit tests: 553 pass, 0 fail
  - Lint: 0 problems
  - Prettier: all files formatted

## Accomplishments

- **P13 — WS auth:** Added `io.use()` JWT handshake in `server.mjs` rejecting sockets without a valid `auth-token` cookie; tightened CORS so production never uses `'*'`; client connects with `withCredentials`. `/api/ws` remains a PUBLIC_API_ROUTE but is now gated by the handshake (middleware comment updated).
- **P14 — Sync replay:** Added a 5-min `SYNC_FRESHNESS_MS` window rejecting stale `generatedAt` (401) and a monotonic `configVersion` guard that no-ops down-versioned replays, both before the cached-config overwrite.
- **P15 — User mutations:** Added `useCreateUser`, `useUpdateUser`, `useUpdateUserQuota`, `useDeleteUser`, `useToggleUserBlock` hooks (shared `USERS_QUERY_KEY`, invalidate on success) and routed the five mutation call sites through them; preserved inline error surfacing (no silent swallowing).

## Task Commits

Workflow automation owns Git operations (branch push + PR). No commits made by the executor; changes are staged in the working tree for the workflow to commit.

## Files Created/Modified

- `server.mjs` — `io.use()` JWT handshake + manual cookie read + production-restricted CORS
- `src/middleware.ts` — clarified `/api/ws` is gated by the io.use() handshake, not the middleware
- `src/hooks/use-websocket.ts` — `withCredentials: true` on connect
- `src/app/api/sync/receive/route.ts` — `SYNC_FRESHNESS_MS` freshness check + monotonic configVersion guard
- `src/app/api/__tests__/sync-receive.test.ts` — fresh timestamp + stale-payload (401) + monotonic-replay no-op tests
- `src/hooks/use-users.ts` — `USERS_QUERY_KEY`, `assertOk`, 5 mutation hooks
- `src/components/users/{create-user,edit-user,user-quota-modal,user-list}.tsx` — adopt mutation hooks

## Decisions Made

- **CORS in production:** `origin` resolves to `NEXT_PUBLIC_APP_URL`/`APP_URL` allowlist, else `false` (CORS disabled). Same-origin panel connections are unaffected; cross-origin requires explicit env. Dev keeps `'*'` for local loopback hosts.
- **Sync freshness scope:** Only enforced when `generatedAt` is a parseable timestamp. Non-ISO values allowed by the schema's `min(1)` fallback defer to version ordering, so existing non-conforming payloads are not broken.
- **Monotonic guard response:** Returns `200 { applied: true, configVersion: <current> }` (idempotent-style) plus a `sync.receive.stale-version` audit log, so legitimate retries and replays are indistinguishable to the sender and non-destructive.
- **No central query-key registry exists yet** (proposal 12.9 / 260603-h8s not implemented); the users key is centralized locally in `use-users.ts` as `USERS_QUERY_KEY`.

## Deviations from Plan

None for P13/P14. One scoped deviation for P15 (documented below).

### P15 — Single-record GET reads left as raw fetch

- **Found during:** P15 wiring (edit-user-modal, user-quota-modal).
- **Issue:** The proposal's acceptance criterion "No raw fetch to `/api/users*` remains in `src/components/users`" is broader than its Solution, which lists only mutation hooks and the five mutation call sites. Two single-record **reads** (`GET /api/users/:id` in edit-user-modal, `GET /api/users/:id/quota` in user-quota-modal) load modal form data.
- **Decision:** Left the two reads as-is. Converting them to `useUser`/`useUserQuota` query hooks is out of the proposal's documented Solution (which targets mutation cache invalidation), would rework modal data-fetching/UX, and is unrelated to the stale-list bug the proposal targets. All five **mutation** sites are fully converted; every successful user mutation now invalidates the `['users']` cache.
- **Impact:** Acceptance checkbox "No raw fetch to `/api/users*`" is partially met — fully met for mutations (the proposal's actual concern), not for the two modal reads.

## Issues Encountered

None.

## User Setup Required

None for behavior. Deployments wanting cross-origin WS access should set `NEXT_PUBLIC_APP_URL` (or `APP_URL`); otherwise same-origin connections work with no configuration. `JWT_SECRET` is already required by the rest of the app.

## Next Phase Readiness

- All three proposals implemented and green (`npm test` PASS).
- Left for a future pass if desired: query-key registry (12.9), `useUser`/`useUserQuota` read hooks to retire the last two `/api/users*` reads.

### Proposals deferred

None — all three source-artifact proposals (13, 14, 15) were implemented. The single-record GET-read nuance above is a sub-acceptance item within P15, not a deferred proposal.

---
*Phase: 999-gh-planning-execution-queue*
*Completed: 2026-06-16*
