---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: Milestone v1.1 archived 2026-06-11
stopped_at: null
last_updated: "2026-06-19T19:54:47.911Z"
last_activity: 2026-06-12 -- Loosen audit-safe auto-approval criteria
progress:
  total_phases: 24
  completed_phases: 24
  total_plans: 57
  completed_plans: 57
  percent: 100
---

# Amnezia Control Panel - Project State

## Project Reference

**Project**: Amnezia Control Panel
**Core Value**: One panel, both VPN systems -- users synchronized between Amnezia AWG and 3x-ui, no context switching
**Current Focus**: v1.1 COMPLETED — Next: Developer automation governance (Phases 13.1-13.4)
**Current Position**: Milestone v1.1 archived

## Current Position

Phase: All v1.1 phases complete (11.1-12.15)
Status: Milestone v1.1 archived 2026-06-11
Last activity: 2026-06-12 -- Loosen audit-safe auto-approval criteria

Progress: [██████████] 100% (v1.1 COMPLETE & ARCHIVED)

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

8 items captured from review of unpushed commits (2026-06-10):

| #   | Area     | Title                                                  | Severity  |
| --- | -------- | ------------------------------------------------------ | --------- |
| 1   | database | Refactor audit-log.ts to use Prisma model layer        | Hard      |
| 2   | api      | Replace 3x-ui HTTP REST calls with direct shell access | Hard      |
| 3   | api      | Restrict XUI_BASE_URL to localhost/127.0.0.1           | Judgement |
| 4   | api      | Stream rulite import instead of fs.readFileSync        | Judgement |
| 5   | api      | Wire importFromRulite() into routing import API        | Gap       |
| 6   | api      | Add audit logging to routing import endpoint           | Gap       |
| 7   | tooling  | Fix supply-chain.yml npm audit signatures integrity    | Minor     |
| 8   | tooling  | Fix dependabot.yml invalid review-automated key        | Minor     |

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

Last session: 2026-06-11T12:00:00Z
Stopped at: null
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
| 2026-06-03 | 260604-12u   | Wake PR orchestrator from dispatched workers                |
| 2026-06-04 | 260605-56h   | Manual-only PRs still run advisory reviews                  |
| 2026-06-04 | 260605-67p   | Maintainer approval label + `/approve` PR flow              |
| 2026-06-10 | 260610-r8l   | Audit-fix PR bodies include source-run links                |
| 2026-06-11 | 260611-7py   | PR-flow preflight uses self-hosted runner                   |
| 2026-06-11 | 260611-7y7   | Merge main into PR #291                                     |
| 2026-06-11 | 260611-85f   | Remove invalid Dependabot config keys                       |
| 2026-06-11 | 260611-cfw   | Grouped Dependabot patch/minor PRs infer body update types  |
| 2026-06-11 | 260611-8f6   | Fix PR-flow workflow governance failures                    |
| 2026-06-11 | 260612-1up   | GHCR Docker image workflow publishes amd64 image            |
| 2026-06-12 | 260612-aap   | Auto PR audit automation runs as scheduled GitHub workflow  |
| 2026-06-12 | 260612-x6c   | graphify-out is ignored local cache with PR policy guard    |
| 2026-06-12 | 260612-vxj   | Managed private GHCR deployment helper and server agent     |
| 2026-06-24 | 260624-stack | Bundled VPN stack Docker image (AWG + 3x-ui + Tailscale)    |
| 2026-06-12 | 260613-1cb   | Audit-safe auto-approval allows 10 files / 400 lines        |
| 2026-06-11 | summary-v1.1 | Milestone v1.1 summary generated for onboarding             |

---

_State initialized: 2026-04-27_
_Last updated: 2026-06-24 - Bundled VPN stack Docker image (quick 260624-stack)_
