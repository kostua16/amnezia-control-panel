# Architectural Review Pass 8 (2026-07-02)

Source: `/gsd:explore` eighth-pass review (non-duplicative vs open PRs and proposals #1-#21).

## Dedup Check

Excluded topics already covered by open PRs or prior proposals:
- VPN service adapter polymorphism (PR #460)
- Typed API client for frontend query hooks (PR #459)
- User creation DB↔VPN consistency (PR #444)
- Schema hygiene / indexes / enum promotion (PR #439)
- Tailscale status call dedup (PR #505)
- Batch server lookups in panel push (PR #499)
- GeoIP CIDR binary search (#1)
- API route handler abstraction / adoption (#2)
- Broadcaster query optimization (#3)
- SQLite WAL mode (#16)
- JWT sliding session (#20)
- CSP nonce hardening (#21)
- All other proposals #1-#21

## Proposals

### #22: Dead WebSocket broadcast bridge — real-time push is non-functional

**Severity:** Critical (Runtime)
**Area:** `src/lib/websocket.ts:87`, `server.mjs:96`

**Problem:**
`broadcastEvent()` checks module-local `ioInstance` (never set) instead of `globalThis.__socketIO` (set by `server.mjs` at startup). `initWebSocketServer()` — the only function that bridges `globalThis.__socketIO` → `ioInstance` — is never called anywhere in the codebase.

Impact chain:
1. `broadcastEvent()` silently no-ops on every call
2. `hasConnectedClients()` always returns `false` (checks `ioInstance`)
3. Broadcaster skips ALL dashboard stats and resource queries (thinks no one is listening)
4. `cachedDashboardStats` is never populated
5. WS→RQ invalidation bridge in `providers.tsx` never fires (no events arrive)
6. Push progress events (`panel:push-progress`) never reach the push wizard
7. Fallback status change events (`panel:fallback-change`) never reach the dashboard

Even though `instrumentation.ts` (proposal #13 fix) now starts `startBroadcaster()`, the broadcaster's output is discarded because the transport layer bridge was never wired.

**Root cause:** `server.mjs` stores the Socket.IO instance on `globalThis.__socketIO` (plain JS cannot import TS). `websocket.ts` declares the global type but its runtime code only reads module-local `ioInstance`, which requires `initWebSocketServer()` to be called — it never is.

**Fix:**
1. Replace `ioInstance` references in `broadcastEvent()`, `hasConnectedClients()`, `getWebSocket()`, `isWebSocketReady()` with `globalThis.__socketIO` reads
2. Remove dead code: `ioInstance` variable, `initWebSocketServer()` function, `initWebSocket()` no-op
3. Move connection tracking (`connectedClients` counter) into `server.mjs`'s `io.on('connection')` handler (it already has one) and expose via `globalThis.__wsClientCount` or similar
4. Verify broadcaster populates `cachedDashboardStats` and events arrive in browser DevTools WS tab

**Files:** `src/lib/websocket.ts` (rewrite), `server.mjs` (add client count export)

---

### #23: Component mutations bypass React Query cache — stale data after user actions

**Severity:** Medium (UX/Correctness)
**Area:** 20+ component files under `src/components/`

**Problem:**
~20 component files use raw `fetch()` for POST/PUT/DELETE operations instead of React Query `useMutation` hooks. After a user creates, edits, deletes, reorders, or applies a resource, the React Query cache is not invalidated via `onSuccess`. Data remains stale until the next `refetchInterval` tick (up to 30 seconds).

The WS→RQ invalidation bridge in `providers.tsx` only fires for server-broadcast events (and currently those are broken — see #22). User-initiated mutations that don't trigger a server-side WS event (most of them) show stale data indefinitely until polling catches up.

Affected operations (sample):
- Create/edit/delete routing rules (`ip-domain-routing-form.tsx`, `routing-rules-list.tsx`)
- Create/edit/delete geo rules (`geo-routing-form.tsx`, `geo-rules-list.tsx`)
- Reorder rules (`geo-routing-form.tsx`, `routing-rules-list.tsx`)
- Apply chain config (`chain-builder.tsx`, `save-chain-dialog.tsx`, `chain-node-routing-drawer.tsx`)
- Push/rollback panels (`push-wizard.tsx`)
- Add/edit/delete servers (`add-server-form.tsx`, `server-list.tsx`)
- Add/edit/delete panels (`add-panel-form.tsx`, `panel-list.tsx`)
- Manage whitelist (`whitelist-manager.tsx`)
- Import configs (`config-list.tsx`)
- Seed templates (`template-gallery.tsx`, `protocol-templates-grid.tsx`)

Additionally, these raw fetch calls:
- Have no centralized error handling (each component has its own try/catch)
- Bypass the `httpClient` wrapper (no timeout enforcement beyond browser defaults)
- Duplicate auth cookie forwarding patterns (implicit via same-origin, but fragile)

**Note:** PR #459 (Typed API Client) covers typed query hooks. This proposal covers the mutation side — a separate, complementary concern.

**Fix:**
1. Extract `useMutation` hooks for each mutation endpoint into `src/hooks/` (e.g., `useCreateRoutingRule`, `useApplyChain`, `usePushPanels`, `useDeleteServer`)
2. Each hook uses `httpClient` for timeout/retry consistency
3. Each hook specifies `onSuccess` invalidation targeting the relevant query key(s)
4. Components replace raw `fetch()` calls with mutation hook invocations

**Files:** New hooks in `src/hooks/use-*.ts`; 20+ component files refactored to use hooks

---

### #24: Redundant panel health probing from two independent subsystems

**Severity:** Medium (Performance/Waste)
**Area:** `src/lib/panel-health-checker.ts`, `src/hooks/use-multi-panel-status.ts`, `src/app/api/panels/status/route.ts`

**Problem:**
Panel health is checked independently by two subsystems with no coordination:

1. **Periodic health checker** (`panel-health-checker.ts:308-363`) — `setInterval` every 30s, loops panels sequentially, runs `testPanel()` (HTTP HEAD to `/api/health`)
2. **API route** (`GET /api/panels/status`) — calls `getPanelConnectionRecords()` which runs `testPanel()` for every active panel via `Promise.all` on every request

The frontend hook `useMultiPanelStatus` polls `GET /api/panels/status` every 30s (`refetchInterval: 30_000`).

With 3 active panels, each panel receives:
- 1 HTTP HEAD from periodic checker (every 30s)
- 3 HTTP HEADs from the status API (every 30s via frontend poll)

That's ~4 health probes per panel every 30 seconds = 8 requests/minute/panel. With 10 panels: 80 requests/minute just for health status.

**Fix:**
1. `GET /api/panels/status` should read from the periodic checker's cached results (already tracked in `consecutiveFailures`, `fallbackPanels`) instead of re-probing
2. Expose a `getPanelHealthSnapshot(): Map<number, PanelHealthSnapshot>` function from `panel-health-checker.ts`
3. The API route returns cached snapshot data; frontend gets near-real-time data via WS `panel:fallback-change` events (once #22 is fixed) instead of polling

**Files:** `src/lib/panel-health-checker.ts` (add snapshot export), `src/app/api/panels/status/route.ts` (read snapshot), `src/hooks/use-multi-panel-status.ts` (adjust interval)
