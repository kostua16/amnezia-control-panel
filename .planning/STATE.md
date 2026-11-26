---
gsd_state_version: 1.0
milestone: post-v1.1
milestone_name: Developer automation governance
status: executing
stopped_at: null
last_updated: "2026-11-26T16:00:00.000Z"
last_activity: 2026-11-26
last_activity_desc: "Completed quick task 261125-pte: PR #1251 review fixes (GSD 1.23.0, Phase 999 tracked separately)"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 4
  completed_plans: 4
  percent: 100
---

# Amnezia Control Panel - Project State

## Project Reference

**Project**: Amnezia Control Panel
**Core Value**: One panel, both VPN systems -- users synchronized between Amnezia AWG and 3x-ui, no context switching
**Current Focus**: post-v1.1 Developer automation governance (Phases 13.1-13.4 delivered and verified; Phase 999 execution queue active)
**Current Position**: Milestone post-v1.1 executing (Phase 999 planning execution queue)

## Current Position

Phase: 999 (gh-planning-execution-queue) — EXECUTING
Plan: 50 of 114
Status: Executing Phase 999
Last activity: 2026-11-26
Last Activity Description: Completed quick task 261125-pte: PR #1251 review fixes (GSD 1.23.0, Phase 999 tracked separately)

Progress: [██████████] 100%

Milestone scope: post-v1.1 governance Phases 13.1-13.4 — 4 of 4 phases, 4 of 4 plans complete.
Execution queue: Phase 999 is a reserved queue phase tracked separately from milestone progress — 50 of 114 plans executed.

## Performance Metrics

**Velocity:**

- Total plans completed: 4 of 4 in the post-v1.1 milestone (Phases 13.1-13.4, recorded in phase SUMMARY/VERIFICATION files)
- Phase 999 execution queue (tracked separately): 50 of 114 plans executed
- Average duration: 4min (historical, v1.1-era plans only; not recorded for post-v1.1 work)
- Total execution time: 102min (historical, v1.1-era plans only; not recorded for post-v1.1 work)

**By Phase (historical, v1.1):**

| Phase     | Plans | Total | Avg/Plan | Notes |
| --------- | ----- | ----- | -------- | ----- |
| 11.1      | 1     | 7min  | 7min     |       |
| 11.2      | 3     | 25min | 8min     |       |
| 11.3      | 3     | 12min | 4min     |       |
| 11.4-11.8 | --    | --    | --       |       |
| 12.1      | 1     | 3min  | 3min     |       |
| 12.2      | 1     | 4min  | 4min     |       |
| 12.3      | 1     | 7min  | 7min     |       |
| 12.4      | 1     | 5min  | 5min     |       |
| 12.5      | 1     | 4min  | 4min     |       |
| 12.6      | 1     | 5min  | 5min     |       |
| 12.7      | 1     | 4min  | 4min     |       |
| 12.8      | 2     | --    | --       | shipped 2026-05-02; durations not recorded |
| 12.9      | 1     | 3min  | 3min     |       |

- Last 5 plans (historical, v1.1): 12.9-01 (3min), 12.7-01 (4min), 12.6-01 (5min), 12.5-01 (4min), 12.4-01 (5min)
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
| 2026-11-26 | 261125-pte   | PR #1251 review fixes: GSD 1.23.0 upgrade, Phase 999 tracked outside milestone progress, 13.1-13.4 records normalized |
| 2026-11-25 | 261125-rla   | Address the eighth CLI counter review for PR #1252 |
| 2026-11-25 | 261125-r45   | Address the seventh CLI counter review for PR #1252 |
| 2026-11-25 | 261125-qoy   | Address the sixth CLI counter review for PR #1252 |
| 2026-11-25 | 261125-qgc   | Address the fifth CLI counter review for PR #1252 |
| 2026-11-25 | 261125-q7t   | Address the fourth CLI counter review for PR #1252 |
| 2026-11-25 | 261125-puv   | Normalize the CLI counter input and test composite PATH updates for PR #1252 |
| 2026-11-25 | 261125-pnc   | Address the third CLI counter review for PR #1252 |
| 2026-11-25 | 261125-pb9   | Address the second CLI counter review for PR #1252 |
| 2026-11-25 | 261125-ow0   | Address counter review feedback for PR #1252 |
| 2026-11-25 | 261125-o4p   | Count GitHub CLI requests and wire the remaining GitHub Script steps |
| 2026-11-25 | 261125-0l9   | Add missing Prisma migration for Server.redirectIp (fixes GET /api/servers 500 on fresh DB) |
| 2026-11-24 | 261124-v61   | Address PR #1223 maintenance review findings |
| 2026-11-23 | 261123-w9f   | Avoid Docker main-push REST comparison and closed-issue authorization |
| 2026-11-23 | 261123-3on | APR-I09 bot-policy compatibility and retry fixes |
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
| 2026-06-24 | 260624-rebase-pr-workflow | Add /rebase branch-refresh workflow (rebase-pr.yml, force-with-lease) |
| 2026-07-09 | 260709-651 | Quick Plan: PR #651 workflow improvement intake (#662) |
| 2026-06-09 | 260609-y7a | VPN Service Adapter — Replace parallel function pairs with polymorphic interface (#460) |
| 2026-06-09 | 260609-t4f | Typed API Client for frontend data hooks (#459) |
| 2026-06-09 | 260609-p3k | User creation DB↔VPN consistency — compensating actions for partial failures (#444) |
| 2026-06-04 | 260604-l3n | Replace STUB public keys in chain-router with real key generation (#442) |
| 2026-07-20 | 260721-4ej | Fix npm audit infrastructure failure classification |
| 2026-08-15 | 260815-n6m | Persistent audit-findings ledger for audit-fix runs (AFX-E02, #1072) |
| 2026-08-15 | 260815-r3p | Harden ledger: schema validation, metadata refresh, --validate gate (AFX-E02 review fixes, PR #1085) |
| 2026-11-22 | 261122-2df | Migrate all workflows from self-hosted to ubuntu-latest, rollback runbook (RUN-M01, #1128) |
| 2026-11-22 | 261122-3zh   | Fix npm audit high+ (next 16.4.6, audit fix, effect/brace-expansion overrides, #1130) |
| 2026-09-27 | 260927-5bp | Migration 20260617 redefines admins/user_quotas (SQLite non-constant-default); the servers.redirectIp migration found along the way landed separately via #1238 |

---

_State initialized: 2026-04-27_
