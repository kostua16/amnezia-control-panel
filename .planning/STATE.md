---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: verifying
stopped_at: context exhaustion at 77% (2026-05-03)
last_updated: '2026-06-03T18:58:45Z'
last_activity: 2026-06-03 -- Fix PR-flow ready status for manual-review PRs
progress:
  total_phases: 23
  completed_phases: 20
  total_plans: 53
  completed_plans: 51
  percent: 96
---

# Amnezia Control Panel - Project State

## Project Reference

**Project**: Amnezia Control Panel
**Core Value**: One panel, both VPN systems -- users synchronized between Amnezia AWG and 3x-ui, no context switching
**Current Focus**: v1.1 Multi-Panel Chain Routing
**Current Position**: Phase 12.7 of 12.7 (Audit Remediation) -- COMPLETE
**Audit Remediation**: Phase 12.1-12.7 complete

## Current Position

Phase: 12.15 of 12.15 (Requirements reconciliation & middleware hardening) -- PLANNED
Plan: 0 of 0 in current phase (planned)
Status: 12.14 complete (GEO-03/04 + TSCL-01-03 verified, audit 19/20)
Last activity: 2026-06-03 -- Fix PR-flow ready status for manual-review PRs

Progress: [█████████] 100% (v1.1 complete; audit remediation in progress)

## Performance Metrics

**Velocity:**

- Total plans completed: 26 (v1.1 + audit)
- Average duration: 4min
- Total execution time: 102min

**By Phase:**

| Phase     | Plans | Total | Avg/Plan |
| --------- | ----- | ----- | -------- | --------------------------- |
| 11.1      | 1     | 7min  | 7min     |
| 11.2      | 3     | 25min | 8min     |
| 11.3      | 3     | 12min | 4min     |
| 11.4-11.8 | --    | --    | --       |
| 12.1      | 1     | 3min  | 3min     |
| 12.2      | 1     | 4min  | 4min     |
| 12.3      | 1     | 7min  | 7min     |
| 12.4      | 1     | 5min  | 5min     |
| 12.5      | 1     | 4min  | 4min     |
| 12.6      | 1     | 5min  | 5min     |
| 12.7      | 1     | 4min  | 4min     |
| 12.8      | 2     | --    | --       | (planned, not yet executed) |
| 12.9      | 1     | 3min  | 3min     |

- Last 5 plans: 12.9-01 (3min), 12.7-01 (4min), 12.6-01 (5min), 12.5-01 (4min), 12.4-01 (5min)
- Trend: stable

_Updated after each plan completion_

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
- 12.2-01: globalThis.\_\_socketIO bridge -- server.mjs (plain JS) cannot import .ts, io instance shared via global
- 12.2-01: instrumentation.ts starts broadcaster -- Next.js compiles .ts imports in register(), broadcaster needs DB access
- 12.5-01: Tab toggle over Tabs component -- no shadcn/ui Tabs available, custom button-based segment control
- 12.5-01: buildServerPanelMap uses Tailscale address matching -- no FK between Server and RemotePanel in schema
- 12.9-01: alert:new removed from WS_TO_QUERY_KEYS -- use-alerts.ts self-invalidates (single source of truth)
- 12.9-01: panel:push-progress and chain:status-update removed from bridge -- no RQ consumers, consumed via lastEvent/direct socket
- 260529-geist: Self-host Geist v1.7.1 via `next/font/local` + committed woff2 under `src/app/fonts/` -- dev6 cannot reach `fonts.gstatic.com` at build time (CI run #26663122321)

### Pending Todos

None yet.

### Blockers/Concerns

- GeoIP: on-disk v2fly-style artifacts + built-in refresh (see 11.5-CONTEXT.md); planner implements file pipeline
- WireGuard/Xray config format specifics for applyChainConfig need real-service validation during Phase 11.4
- 3x-ui REST API is community-maintained -- pin supported version range in documentation

## Deferred Items

| Category    | Item                                                                    | Status                        | Deferred At |
| ----------- | ----------------------------------------------------------------------- | ----------------------------- | ----------- |
| Tech debt   | In-memory geo-routing state lost on restart                             | Being addressed in Phase 11.5 | v1.0 close  |
| Integration | applyChainConfig stub needs real CLI commands                           | Being addressed in Phase 11.4 | v1.0 close  |
| TS errors   | Pre-existing TS errors in chain-flow-editor.tsx, chain-presets/route.ts | Out of scope for 12.4         | 12.4        |

## Session Continuity

Last session: 2026-05-03T10:04:26.496Z
Stopped at: context exhaustion at 77% (2026-05-03)
Resume file: None

## Quick Tasks Completed

| Date       | Slug / ID    | Summary                                                     |
| ---------- | ------------ | ----------------------------------------------------------- |
| 2026-04-30 | 260430-q7v   | Dev default port 3333; override via CLI/PORT                |
| 2026-04-30 | 260430-r2n   | npm `--port` shorthand support + Next lock behavior         |
| 2026-05-29 | 260529-geist | Self-host Geist fonts (dev6 gstatic block, CI #26663122321) |
| 2026-05-31 | 260531-pol   | Issue #152 turn budgets + Claude failed-tool reporting      |
| 2026-05-31 | 260531-qyb   | Refactor `scan-claude-logs` into tested CJS scanner         |
| 2026-06-03 | 260603-nhf   | Fix PR orchestrator stalled review fan-out                  |
| 2026-06-03 | 260603-u1d   | PR orchestrator visibility + required aggregate status      |
| 2026-06-03 | 260603-x6b   | Fix PR-flow ready status for manual-review PRs              |

---

_State initialized: 2026-04-27_
_Last updated: 2026-06-03 - Fix PR-flow ready status for manual-review PRs (quick 260603-x6b)_
