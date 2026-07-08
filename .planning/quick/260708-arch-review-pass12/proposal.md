# Architectural Review Pass 12 (2026-07-08)

Source: `/gsd:explore` twelfth-pass review (non-duplicative vs proposals #1-#33 and open PRs #442, #444, #459, #460, #489, #495, #497, #498, #499, #505, #561, #628, #643).

## Deduped vs Open PRs

- PR #459: Typed API Client — excludes frontend mutation hooks (already proposed)
- PR #460: VPN Service Adapter polymorphism — excludes vpn-services decomposition
- PR #444: User Creation DB↔VPN Consistency — excludes transaction boundaries
- PR #505: Tailscale status call dedup — excludes API key fast-hash
- PR #499: Batch server lookups — excludes config-applier shared helper

## Deduped vs Proposals #1-#33

- #17 Security response headers: CSP/X-Frame-Options — distinct from CSRF tokens
- #19 SQLite backup: storage ops — distinct from traffic boundary correctness
- #20 JWT sliding session: already implemented (`shouldRefreshToken` in `auth-jwt.ts`)
- #25 Alert retention cleanup: already implemented (`cleanupOldAlerts` in broadcaster)
- #26 CIDR matching: already fixed (`cidr-match.ts` with proper bitwise matching)
- #28 PanelConnectionHistory: already removed from schema
- #30 Configuration.name unique: already added to schema
- #22 Dead WebSocket bridge: already fixed (uses `globalThis.__socketIO?.emit()`)

## Proposals

### #34: No CSRF protection for state-changing API routes

**Severity:** Medium (Security)

**Problem:** Authentication uses an httpOnly cookie with `sameSite: 'lax'`. This protects cross-site GET requests but does NOT protect POST/PUT/DELETE — browsers send `lax` cookies with top-level navigation POSTs (form submissions). A malicious page can submit a hidden `<form action="https://panel-host/api/users" method="POST">` to create users, delete users, modify routing rules, or push configurations while the admin has an active session.

**Evidence:**
- `src/app/api/auth/login/route.ts:84` — sets `auth-token` cookie with `sameSite: 'lax'`
- `src/proxy.ts` / middleware — validates JWT from cookie but does not check Origin or CSRF token
- All state-changing routes (users, servers, panels, chains, routing) accept POST/PUT/DELETE with cookie-only auth

**Fix:** Add Origin header validation in the auth middleware — reject requests where `Origin` header is present and doesn't match the panel's own origin. For a single-server deployment this is sufficient. For future multi-origin deployments, add double-submit cookie pattern.

**Files:** `src/middleware.ts` (extend), or new `src/lib/csrf.ts`

---

### #35: Server-timezone-dependent traffic aggregation boundary

**Severity:** Medium (Correctness)

**Problem:** Dashboard traffic stats and quota monitoring compute month boundaries using `new Date(now.getFullYear(), now.getMonth(), 1)` which uses the **server's local timezone**, not the admin's configured timezone or UTC. This means:
- Monthly quota resets happen at midnight server-time, not admin midnight
- Dashboard traffic window (`TRAFFIC_STATS_WINDOW_HOURS`) is server-TZ-dependent
- An admin in UTC+3 sees their "monthly" traffic window shift by 3 hours from expected

**Evidence:**
- `src/lib/dashboard-stats.ts:4-10` — `TRAFFIC_STATS_WINDOW_HOURS` config exists but window boundary uses server local time
- `src/lib/dashboard-stats.ts:25` — `new Date(Date.now() - TRAFFIC_STATS_WINDOW_MS)` — this is relative (OK), but month-start below is not
- `src/lib/quota-monitor.ts:133-134` — `new Date(now.getFullYear(), now.getMonth(), 1)` — month start uses server local TZ
- `src/lib/traffic-log-cleanup.ts` — likely has same pattern (cleanup boundary)

**Fix:** Use UTC-based month boundaries (`Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)`) as default, or add a `TZ` env var (`process.env.PANEL_TIMEZONE`) parsed via `Intl.DateTimeFormat` for admin-configurable timezone. The relative window in dashboard-stats is unaffected (it's `Date.now() - N ms`), but quota month-start and traffic-log cleanup need the fix.

**Files:** `src/lib/quota-monitor.ts:133`, `src/lib/dashboard-stats.ts`, `src/lib/traffic-log-cleanup.ts`
