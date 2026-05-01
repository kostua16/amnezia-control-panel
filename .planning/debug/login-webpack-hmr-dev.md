---
status: resolved
trigger: need to fix the issue during login at milestone 1.1 (dev server log)
created: 2026-05-02
updated: 2026-05-02
---

## Symptoms

- **Expected:** Development login flow works without console/dev-server errors; HMR connects.
- **Actual:** Next.js logs `Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from "127.0.0.1"`.
- **Errors:** See terminal; `GET /login` returns 200 — page loads; HMR is blocked.
- **Timeline:** Observed during `npm run dev` on port 3333.
- **Reproduction:** Open the app using one hostname (e.g. `http://localhost:3333`) while the browser or an extension resolves HMR against `127.0.0.1`, or mix hostnames between tabs/bookmarks.

## Current Focus

- **hypothesis:** Host mismatch between document origin and webpack-hmr WebSocket origin triggers Next.js dev cross-origin guard.
- **next_action:** Add `allowedDevOrigins` in `next.config.ts` and restart dev server.

## Evidence

- timestamp: 2026-05-02 — Terminal shows blocked `/ _next/webpack-hmr` from `127.0.0.1` with official remediation to set `allowedDevOrigins`.

## Eliminated

- (none)

## Resolution

- **root_cause:** Default Next.js dev security blocks cross-origin access to dev-only endpoints when the requesting host is not allowlisted.
- **fix:** Set `allowedDevOrigins: ['127.0.0.1', 'localhost']` in `next.config.ts`.
- **verification:** Restart `npm run dev`, load `/login` from usual URL; HMR warning should not appear for allowlisted hosts.
- **files_changed:** `next.config.ts`
