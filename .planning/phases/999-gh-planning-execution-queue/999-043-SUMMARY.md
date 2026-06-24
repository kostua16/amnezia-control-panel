---
plan: 999-043
phase: 999
status: complete
source_artifact: ".planning/quick/260624-arch-review-pass6/260624-PLAN.md"
source_artifact_sha256: fc54ab8f01363d2362e5030c0fd8fb6798c3496468e3101a288c52026d09031d
source_pr: "444"
---

# Summary: Architectural Review Pass 6 (2026-06-24)

## What was built

Three proposals from the merged arch-review artifact, all implemented and verified:

### #16 — SQLite WAL mode for write concurrency
- Modified `src/lib/prisma.ts` to append `journal_mode=wal` and `busy_timeout=5000` to the DATABASE_URL
- WAL mode allows concurrent reads during writes, eliminating database lock contention from traffic log inserts, periodic cleanups, and simultaneous API writes
- Busy timeout retries on lock instead of failing immediately
- URL parameter parsing preserves existing DATABASE_URL overrides

### #17 — Security response headers via Next.js middleware
- Created `src/middleware.ts` with security headers on every response:
  - `X-Frame-Options: DENY` — blocks clickjacking
  - `X-Content-Type-Options: nosniff` — prevents MIME sniffing
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy` — allows same-origin, inline scripts/styles (Next.js), WebSocket (Socket.IO), data/blob images
- Matcher skips static assets and images for performance

### #18 — Bounded parallelism for VPN service loops
- Replaced sequential `for` loops in user DELETE handler with `Promise.allSettled` — parallel VPN service deletions
- Replaced sequential service remove/add loops in PUT handler with `Promise.allSettled` — parallel VPN calls, sequential DB writes
- Replaced sequential user loop in `syncAllUsers()` with bounded-concurrency batching (5 concurrent) — O(N/5) instead of O(N)
- `Promise.allSettled` ensures partial VPN failures don't abort the entire operation

## Files modified
- `src/lib/prisma.ts` — WAL mode + busy timeout
- `src/middleware.ts` — new file, security headers
- `src/app/api/users/[id]/route.ts` — parallel VPN calls in DELETE and PUT
- `src/lib/user-sync.ts` — bounded-concurrency syncAllUsers

## Verification
- TypeScript: 0 errors
- ESLint: 0 errors (4 pre-existing warnings in unrelated files)
- Prettier: all files clean
- Unit tests: 641/641 pass
- Workflow e2e tests: 323/323 pass

## Self-Check: PASSED
