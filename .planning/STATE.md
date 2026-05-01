---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Multi-Panel Chain Routing
status: in-progress
stopped_at: context exhaustion at 76% (2026-05-01)
last_updated: "2026-05-01T16:56:11Z"
last_activity: 2026-05-01 -- 12.7-01 complete (11.1-VERIFICATION.md created, TSCL-01-04 verified, audit score 26/35)
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 32
  completed_plans: 32
  percent: 100
---

# Amnezia Control Panel - Project State

## Project Reference

**Project**: Amnezia Control Panel
**Core Value**: One panel, both VPN systems -- users synchronized between Amnezia AWG and 3x-ui, no context switching
**Current Focus**: v1.1 Multi-Panel Chain Routing
**Current Position**: Phase 12.7 of 12.7 (Audit Remediation) -- COMPLETE
**Audit Remediation**: Phase 12.1-12.7 complete

## Current Position

Phase: 12.7 of 12.7 (Audit Remediation) -- COMPLETE
Plan: 1 of 1 in current phase (complete)
Status: 12.7-01 complete
Last activity: 2026-05-01 -- 12.7-01 complete (11.1-VERIFICATION.md created, TSCL-01-04 verified, audit score 26/35)

Progress: [█████████] 100% (v1.1 complete; audit remediation in progress)

## Performance Metrics

**Velocity:**

- Total plans completed: 25 (v1.1 + audit)
- Average duration: 4min
- Total execution time: 99min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 11.1 | 1 | 7min | 7min |
| 11.2 | 3 | 25min | 8min |
| 11.3 | 3 | 12min | 4min |
| 11.4-11.8 | -- | -- | -- |
| 12.1 | 1 | 3min | 3min |
| 12.2 | 1 | 4min | 4min |
| 12.3 | 1 | 7min | 7min |
| 12.4 | 1 | 5min | 5min |
| 12.5 | 1 | 4min | 4min |
| 12.6 | 1 | 5min | 5min |
| 12.7 | 1 | 4min | 4min |

- Last 5 plans: 12.7-01 (4min), 12.6-01 (5min), 12.5-01 (4min), 12.4-01 (5min), 12.3-01 (7min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.1: Tailscale as exclusive transport layer (zero new dependencies)
- v1.1: Central-push-only sync model (no bidirectional sync)
- v1.1: Hybrid autonomy -- remote panels cache config, operate independently when central is down
- v1.1 geo Phase 11.5: v2fly/geoip-style on-disk DB + periodic refresh (see `11.5-CONTEXT.md`)
- 11.1-01: advertisedSubnets stored as JSON-encoded String (SQLite Prisma connector does not support String[])
- 11.1-01: toNodeInfo strips PublicKey per T-11.1-02 information disclosure mitigation
- 11.3-03: API keys cached in volatile memory only (Map) for auto-resync, never persisted to DB
- 12.1-01: Middleware returns JSON 401 for API routes (not redirect); page routes redirect to /login
- 12.1-01: Public API routes excluded from JWT: auth/login, health, ws, sync/receive, sync/apply
- 12.1-01: auth/me uses decodeJwt (no verify) since middleware already validated token
- 12.2-01: Custom server (server.mjs) over instrumentation-only for Socket.IO -- register() provides no HTTP server access
- 12.2-01: globalThis.__socketIO bridge -- server.mjs (plain JS) cannot import .ts, io instance shared via global
- 12.2-01: instrumentation.ts starts broadcaster -- Next.js compiles .ts imports in register(), broadcaster needs DB access
- 12.5-01: Tab toggle over Tabs component -- no shadcn/ui Tabs available, custom button-based segment control
- 12.5-01: buildServerPanelMap uses Tailscale address matching -- no FK between Server and RemotePanel in schema

### Pending Todos

None yet.

### Blockers/Concerns

- GeoIP: on-disk v2fly-style artifacts + built-in refresh (see 11.5-CONTEXT.md); planner implements file pipeline
- WireGuard/Xray config format specifics for applyChainConfig need real-service validation during Phase 11.4
- 3x-ui REST API is community-maintained -- pin supported version range in documentation

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Tech debt | In-memory geo-routing state lost on restart | Being addressed in Phase 11.5 | v1.0 close |
| Integration | applyChainConfig stub needs real CLI commands | Being addressed in Phase 11.4 | v1.0 close |
| TS errors | Pre-existing TS errors in chain-flow-editor.tsx, chain-presets/route.ts | Out of scope for 12.4 | 12.4 |

## Session Continuity

Last session: 2026-05-01T16:52:00Z
Stopped at: Completed 12.7-01 (all audit remediation phases complete)
Resume file: None

## Quick Tasks Completed

| Date       | Slug / ID        | Summary                                      |
| ---------- | ---------------- | -------------------------------------------- |
| 2026-04-30 | 260430-q7v       | Dev default port 3333; override via CLI/PORT |
| 2026-04-30 | 260430-r2n       | npm `--port` shorthand support + Next lock behavior |

---
*State initialized: 2026-04-27*
*Last updated: 2026-05-01 - 12.7-01 complete (TSCL-01-04 verified, audit score 26/35)*
