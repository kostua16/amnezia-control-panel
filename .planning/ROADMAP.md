# Roadmap: Amnezia Control Panel

## Milestones

- **v1.0** -- Phases 1.1-10.4 (shipped 2026-04-29)
- **v1.1 Multi-Panel Chain Routing** -- Phases 11.1-11.8 (shipped 2026-05-01) [archive](.planning/milestones/v1.1-ROADMAP.md)
- **Post-v1.1 audit remediation** -- Phases 12.1-12.12 (in progress; closure audit: `.planning/v12.x-audit-closure-MILESTONE-AUDIT.md`)
- **Developer automation governance** -- Phases 13.1-13.4 (planned)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 (Phases 1.1-10.4) -- SHIPPED 2026-04-29</summary>

- [x] Phase 1.1: Project Initialization
- [x] Phase 1.2: Core Dependencies
- [x] Phase 1.3: Database Schema Setup
- [x] Phase 1.4: Basic Project Structure
- [x] Phase 1.5: Dev Environment Setup
- [x] Phase 1.6: Layout & Navigation
- [x] Phase 1.7: Login Page UI
- [x] Phase 2.1: Authentication Context
- [x] Phase 2.2: Login API Endpoint
- [x] Phase 2.3: Session Management
- [x] Phase 2.4: Protected Routes
- [x] Phase 2.5: Logout Functionality
- [x] Phase 3.1: Service Status API
- [x] Phase 3.2: Status Display Component
- [x] Phase 3.3: Service Install API - AWG
- [x] Phase 3.4: Service Install API - 3x-ui
- [x] Phase 3.5: Service Uninstall APIs
- [x] Phase 3.6: Auto-restart Logic
- [x] Phase 3.7: Configuration Display
- [x] Phase 4.1: User Database Models
- [x] Phase 4.2: User List Component
- [x] Phase 4.3: User Creation Form
- [x] Phase 4.4: User Creation API
- [x] Phase 4.5: User Edit Form
- [x] Phase 4.6: User Edit API
- [x] Phase 4.7: User Delete API
- [x] Phase 4.8: Block/Unblock APIs
- [x] Phase 4.9: User Sync System
- [x] Phase 5.1: Configuration Templates
- [x] Phase 5.2: Protocol Templates
- [x] Phase 5.3: Auto-gen Configuration API
- [x] Phase 5.4: Export Configurations
- [x] Phase 5.5: Import Configurations
- [x] Phase 5.6: Configuration Presets
- [x] Phase 5.7: Configuration Manager UI
- [x] Phase 6.1: Traffic Quotas System
- [x] Phase 6.2: Speed Limits System
- [x] Phase 6.3: Routing Rules API
- [x] Phase 6.4: Routing Rules UI
- [x] Phase 6.5: Rule Enforcement
- [x] Phase 7.1: Dashboard Metrics
- [x] Phase 7.2: Traffic Statistics API
- [x] Phase 7.3: Stats Display UI
- [x] Phase 7.4: Resource Monitoring API
- [x] Phase 7.5: Resource Display UI
- [x] Phase 7.6: Real-Time Updates
- [x] Phase 8.1: Multi-server Management
- [x] Phase 8.2: Server Configuration
- [x] Phase 8.3: Chain Templates System
- [x] Phase 8.4: Auto-configure Routing
- [x] Phase 9.1: Visual Chain Builder
- [x] Phase 9.2: Geo-Routing Rules
- [x] Phase 9.3: Whitelist Management
- [x] Phase 9.4: Live Chain Visualization
- [x] Phase 10.1: Service Alert System
- [x] Phase 10.2: Quota Alert System
- [x] Phase 10.3: Resource Alert System
- [x] Phase 10.4: UI Polish & Responsive Design

</details>

### Current Milestone: Audit gap closure (Phases 12.1-12.12)

**Closure audit:** `.planning/v12.x-audit-closure-MILESTONE-AUDIT.md` (supersedes "all 12.x complete" until 12.8-12.12 ship). **Nyquist `*-VALIDATION.md` for 12.x:** backlog -- run `/gsd-validate-phase` when required.

- [x] **Phase 12.1: Admin API JWT enforcement** -- PROJ-AUTH-01; JWT unused on most `/api` routes
- [x] **Phase 12.2: Real-time stack (Socket.IO)** -- PROJ-RT-01; server not attached; chain client protocol mismatch
- [x] **Phase 12.3: v1.0 traceability & verification debt** -- PROJ-TRACE-01; REQ mapping + targeted `VERIFICATION.md` / Nyquist pilot
- [x] **Phase 12.4: Sync apply & WS cache invalidation** -- GAPL-01, GAPL-02; `/api/sync/apply` endpoint created; React Query + WS invalidation wired
- [x] **Phase 12.5: Multi-panel push UX integration** -- CPUSH-01-06, CHAIN-01, VISED-03; PushWizard mounted on `/panels/push`; panels/serverPanelMap passed to ChainFlowEditor
- [x] **Phase 12.6: Geo-routing runtime E2E** -- GEO-03, GEO-04; resolveGeoRoute wired into rule-enforcement and chain-router; GEO-04 narrowed to v2fly scope
- [x] **Phase 12.7: Tailscale milestone verification** -- TSCL-01-04; 11.1-VERIFICATION.md created; 11.2 corrected; audit score raised to 26/35
- [x] **Phase 12.8: Sync apply & receive contracts** -- GAPL-01, CHAIN-01 (applier path); HMAC + body/response alignment for `config-applier` -> `/api/sync/apply` and `panel-sync-client` -> `/api/sync/receive` (shipped 2026-05-02)
- [x] **Phase 12.9: WebSocket -> React Query key alignment** -- GAPL-02, PROJ-RT-01; `providers.tsx` invalidation keys match `use-dashboard-stats`, `use-system-resources`, `use-multi-panel-status` (shipped 2026-05-02)
- [x] **Phase 12.10: Push wizard & per-panel sync fixes** -- CPUSH-01-06, VISED-03 (closure); real panel API keys in PushWizard/rollback; `generatePerPanelConfig` / Xray rule panel scoping; reliable per-panel status/errors
- [x] **Phase 12.11: Tailscale transport in chain apply** -- TSCL-04, CHAIN-01 (transport); `chain-router` / `chains/apply` use panel URL / tailnet resolution (not raw `hostname:22`)
- [x] **Phase 12.12: 12.x verification artifacts** -- PROJ-AUTH-01 evidence; `12.1-`, `12.4-`, `12.6-`, `12.7-`, `12.11-VERIFICATION.md`; `REQUIREMENTS.md` 7 checkboxes reconciled (2026-05-02)
- [x] **Phase 12.13: Verification artifacts (12.1, 12.4)** ~~PROJ-AUTH-01, GAPL-01, GAPL-02 evidence; create `12.1-VERIFICATION.md` and `12.4-VERIFICATION.md`~~ ✅ 2026-05-03
- [x] **Phase 12.14: Verification artifacts (12.6, 12.7)** -- GEO-03, GEO-04, TSCL-01-03 evidence; create `12.6-VERIFICATION.md` and `12.7-VERIFICATION.md` (2026-05-03)
- [ ] **Phase 12.15: Requirements reconciliation & middleware hardening** -- 15+ checkboxes, traceability table, middleware matcher `/panels/:path*` + `/templates/:path*`

### Phase 12.13: Verification artifacts (12.1, 12.4)
**Goal:** Create VERIFICATION.md for phases 12.1 and 12.4 with structured evidence for PROJ-AUTH-01, GAPL-01, GAPL-02.
**Depends on:** None (documentation, code already shipped)
**Requirements:** PROJ-AUTH-01, GAPL-01, GAPL-02
**Gap closure:** Closes BLOCKER-1 (partial) and PROJ-AUTH-01 unsatisfied requirement from v12.x audit
**Plans:** 2 plans (1 wave) -- Complete 2026-05-03

Plans:
- [x] 12.13-01-PLAN.md -- Create 12.1-VERIFICATION.md with PROJ-AUTH-01 evidence (Wave 1)
- [x] 12.13-02-PLAN.md -- Create 12.4-VERIFICATION.md with GAPL-01 and GAPL-02 evidence (Wave 1)

### Phase 12.14: Verification artifacts (12.6, 12.7)
**Goal:** Create VERIFICATION.md for phases 12.6 and 12.7 with structured evidence for GEO-03, GEO-04, TSCL-01-03.
**Depends on:** None (documentation, code already shipped)
**Requirements:** GEO-03, GEO-04, TSCL-01, TSCL-02, TSCL-03
**Gap closure:** Closes BLOCKER-1 (remaining), upgrades GEO-03/04 from partial to satisfied
**Plans:** 3 plans (2 waves) -- Planned 2026-05-03

Plans:
- [ ] 12.14-01-PLAN.md -- Create 12.6-VERIFICATION.md with GEO-03 and GEO-04 evidence (Wave 1)
- [ ] 12.14-02-PLAN.md -- Create 12.7-VERIFICATION.md with TSCL-01-03 meta-verification evidence (Wave 1)
- [ ] 12.14-03-PLAN.md -- Reconcile REQUIREMENTS.md checkboxes and traceability for GEO-03/04, TSCL-01-03; update v12.x-MILESTONE-AUDIT.md (Wave 2)

### Phase 12.15: Requirements reconciliation & middleware hardening
**Goal:** Reconcile 15+ unchecked REQUIREMENTS.md checkboxes with verified evidence; update stale traceability entries; harden middleware matcher.
**Depends on:** Phase 12.13, Phase 12.14 (VERIFICATION.md must exist before reconciliation)
**Requirements:** GAPL-01, CHAIN-01 (traceability fix); PROJ-AUTH-01 (verification closure)
**Gap closure:** Closes WARNING-1 (middleware matcher), FLOW-6 (verification closure), and REQUIREMENTS.md checkbox debt
**Plans:** TBD (`/gsd-plan-phase 12.15`)

### Next Milestone: Developer automation governance (Phases 13.1-13.4)

- [ ] **Phase 13.1: Workflow governance hardening** -- central policy, maintainer-only triggers, explicit manual-only workflow/planning paths
- [ ] **Phase 13.2: CI and supply-chain correctness** -- deterministic release notes, pinned bootstrap tooling, hard failures for push/build regressions
- [ ] **Phase 13.3: PR finalizer and approval policy** -- signal-only reviews, trusted auto-approval, and controlled auto-merge
- [ ] **Phase 13.4: Claude+GSD planning automation** -- trusted improvement analysis, draft planning PRs, and roadmap intake artifacts

**Improvement intake from PR automation**
<!-- AUTO-13X-INTAKE-START -->
<!-- PR-IMPROVE:182 --> - PR #182: fix(audit): address autonomous audit findings -- 13.2 x2, 13.3 x1, 13.4 x1. Quick artifact: `.planning/quick/260603-pr182-workflow-improve/260603-pr182-PLAN.md`.
<!-- PR-IMPROVE:191 --> - PR #191: [codex] ci: orchestrate PR automation flow -- 13.1 x1, 13.2 x1, 13.3 x1, 13.4 x1. Quick artifact: `.planning/quick/260603-pr191-workflow-improve/260603-pr191-PLAN.md`.
<!-- AUTO-13X-INTAKE-END -->

### Phase 13.1: Workflow governance hardening
**Goal:** Centralize workflow trust policy, maintainer-only triggers, and manual-only file/path rules so write-capable automation has one authoritative policy surface.
**Depends on:** Phase 12.15
**Requirements:** Internal workflow governance and trust-boundary hardening
**Plans:** Seeded in `.planning/phases/13.1-workflow-governance-hardening/13.1-PLAN.md`

### Phase 13.2: CI and supply-chain correctness
**Goal:** Remove ambiguous workflow behavior, pin mutable automation bootstrap sources, and make CI helper workflows fail loudly when their underlying work fails.
**Depends on:** Phase 13.1
**Requirements:** Internal CI determinism and supply-chain hardening
**Plans:** Seeded in `.planning/phases/13.2-ci-supply-chain-correctness/13.2-PLAN.md`

### Phase 13.3: PR finalizer and approval policy
**Goal:** Normalize AI review outputs into policy labels and let a single finalizer decide whether a trusted PR can be approved and auto-merged.
**Depends on:** Phase 13.1, Phase 13.2
**Requirements:** Trusted automation approval path with manual-only exceptions
**Plans:** Seeded in `.planning/phases/13.3-pr-finalizer-approval-policy/13.3-PLAN.md`

### Phase 13.4: Claude+GSD planning automation
**Goal:** Turn qualifying PRs into planning intake artifacts and draft roadmap follow-up PRs without executing untrusted PR code in a write-capable context.
**Depends on:** Phase 13.1, Phase 13.3
**Requirements:** Trusted planning automation and roadmap intake capture
**Plans:** Seeded in `.planning/phases/13.4-claude-gsd-planning-automation/13.4-PLAN.md`

## Phase Details

### Phase 11.1: Tailscale Foundation
**Goal**: Each server runs Tailscale as a subnet router, enabling encrypted mesh connectivity between all panels as the transport layer for all inter-panel communication.
**Depends on**: v1.0 (Phase 10.4)
**Requirements**: TSCL-01, TSCL-02, TSCL-03, TSCL-04
**Success Criteria** (what must be TRUE):
  1. Admin can configure Tailscale subnet router on any server following step-by-step documentation
  2. Central panel lists all Tailscale nodes in the tailnet with their IPs, hostnames, and online status
  3. Panel uses Tailscale IPs (not public IPs) as transport addresses for all inter-panel API calls
  4. Each server's VPN subnet is properly advertised and reachable from other nodes in the tailnet
**Plans**: 3 plans (2 waves)

Plans:
- [x] 11.1-01-PLAN.md -- Types, Prisma schema extension, and TailscaleManager utility (Wave 1)
- [x] 11.1-02-PLAN.md -- Setup wizard API routes: step verification and subnet advertisement (Wave 2)
- [x] 11.1-03-PLAN.md -- Node listing API and per-server Tailscale transport address resolution (Wave 2)

### Phase 11.2: Remote Panel Registration
**Goal**: Admin can register, test connectivity to, monitor, and manage remote panels from the central panel, forming the multi-panel topology.
**Depends on**: Phase 11.1
**Requirements**: MPAN-01, MPAN-02, MPAN-03, MPAN-04
**Success Criteria** (what must be TRUE):
  1. Admin can add a remote panel by providing Tailscale IP, panel URL, and auth credentials
  2. Admin can run a connectivity test that confirms the remote panel is reachable and authenticated
  3. Central panel displays real-time connection status (connected/offline/error) for each registered remote panel
  4. Admin can edit panel details and remove panels that are no longer in use
**Plans**: 3 plans (2 waves)
**UI hint**: yes

Plans:
- [x] 11.2-01-PLAN.md -- RemotePanel Prisma model, TypeScript types, and CRUD API routes (Wave 1)
- [x] 11.2-02-PLAN.md -- Connectivity test endpoint and real-time status monitoring (Wave 2)
- [x] 11.2-03-PLAN.md -- Remote panel management UI: register, edit, remove, status display, details drawer (Wave 2)

### Phase 11.3: Panel Sync Protocol & Hybrid Autonomy
**Goal**: Central panel can push configurations to remote panels over the Tailscale mesh, and remote panels cache their last-known-good config to operate autonomously when central is unreachable.
**Depends on**: Phase 11.2
**Requirements**: CPUSH-01, CPUSH-02, CPUSH-03, HAUT-01, HAUT-02, HAUT-03
**Success Criteria** (what must be TRUE):
  1. Central panel can push chain configuration to all registered remote panels and receive per-panel success/failed status
  2. Central panel generates per-panel chain config based on each panel's role in the chain topology
  3. Remote panels cache their last-known-good configuration locally in SQLite
  4. When central panel becomes unreachable, remote panels continue operating on their cached configuration
  5. Config sync resumes automatically when central connection is restored
**Plans**: 3 plans (2 waves)

Plans:
- [x] 11.3-01-PLAN.md -- PanelSyncClient types, HMAC utility, and config push with retry (Wave 1)
- [x] 11.3-02-PLAN.md -- CachedPanelConfig model and sync receive API route (Wave 1)
- [x] 11.3-03-PLAN.md -- Hybrid autonomy: fallback detection, auto-resync, push/status endpoints (Wave 2)

### Phase 11.4: Chain Config Application & Push UX
**Goal**: Pushed chain configurations are actually applied to AWG and 3x-ui services on remote servers, with diff preview, rollback, and actionable error reporting.
**Depends on**: Phase 11.3
**Requirements**: CPUSH-04, CPUSH-05, CPUSH-06, CHAIN-01, CHAIN-02, CHAIN-03
**Success Criteria** (what must be TRUE):
  1. Pushed chain config is applied to AWG services via CLI commands over Tailscale and to 3x-ui via its REST API
  2. Admin can preview a config diff before pushing to see exactly what will change on each remote panel
  3. Admin can roll back a pushed configuration on any remote panel to its previous known-good state with one click
  4. Push errors display actionable recommendations and known fixes for common failure modes
**Plans**: 5 plans (4 waves)
**UI hint**: yes

Plans:
- [x] 11.4-01-PLAN.md -- Real config applier (AWG CLI + 3x-ui REST) and structured error reporter (Wave 1)
- [x] 11.4-02-PLAN.md -- Rollback mechanism: schema extension, previous config storage, one-click restore (Wave 2)
- [x] 11.4-03-PLAN.md -- Config diff preview: computation utility and API endpoint (Wave 2)
- [x] 11.4-04-PLAN.md -- Push UX page: 4-step wizard with diff, progress, rollback, and error display (Wave 3)
- [x] 11.4-05-PLAN.md -- Gap closure: chain template selector, chainConfigRef fix, push status endpoint (Wave 4)

### Phase 11.5: Geo-Routing & Routing Rules
**Goal**: Geo-routing rules are persisted to SQLite, traffic is routed based on destination geo via GeoIP lookup, and routing rules support full CRUD with template presets.
**Depends on**: Phase 11.4
**Requirements**: GEO-01, GEO-02, GEO-03, GEO-04, RULE-01, RULE-02, RULE-03
**Success Criteria** (what must be TRUE):
  1. Geo-routing rules are persisted to SQLite and survive panel restarts (replacing v1.0 in-memory stores)
  2. Admin can create, edit, delete, and reorder routing rules with priority, match conditions (IP/host/geo), and actions (direct/chain/block)
  3. Traffic is routed to specific chain hops based on destination country via GeoIP lookup
  4. Admin can load routing rule files from v2fly/geoip and sendmiche/rulite repositories for auto-population
  5. Routing rule templates with best-practice defaults are available for quick configuration
**Plans**: 5 plans (3 waves)

Plans:
- [x] 11.5-01-PLAN.md -- Prisma schema, types, migration from in-memory stores, schema push (Wave 1)
- [x] 11.5-02-PLAN.md -- GeoIP database manager, v2fly geoip.dat download, lookup service, status/refresh API (Wave 2)
- [x] 11.5-03-PLAN.md -- Geo rule reorder, IP/domain individual CRUD, batch operations, Prisma-backed rule evaluation (Wave 2)
- [ ] 11.5-04-PLAN.md -- Routing rules UI: tabs, geo rules list, geo rule drawer, GeoIP status badge (Wave 3)
- [ ] 11.5-05-PLAN.md -- Templates library, geoip.dat import, template gallery, starter rules (Wave 3)

### Phase 11.6: Visual Chain Editor
**Goal**: Admin can visually build and edit chain topology with drag-and-drop, see panel boundaries, and edit routing rules inline within the editor.
**Depends on**: Phase 11.2 (panel registration), Phase 11.5 (routing rules)
**Requirements**: VISED-01, VISED-02, VISED-03
**Success Criteria** (what must be TRUE):
  1. Admin can build chain topology by placing and connecting nodes with drag-and-drop
  2. Chain editor displays clear panel boundaries showing which panel owns which nodes
  3. Admin can edit routing rules inline within the chain editor without navigating to a separate page
**Plans**: 3 plans (2 waves)
**UI hint**: yes

Plans:
- [x] 11.6-01-PLAN.md -- React Flow canvas, custom node with 4 handles, toolbar, minimap, zoom controls (Wave 1)
- [x] 11.6-02-PLAN.md -- Panel boundary group nodes, server-to-panel mapping, cross-panel edge styling (Wave 2)
- [x] 11.6-03-PLAN.md -- Inline routing rules drawer with tabbed CRUD, auto-save debounce, Apply to Panels (Wave 2)

### Phase 11.7: Pre-Configuration Templates
**Goal**: Admin can use pre-built templates for VPN protocols, server configurations, routing rule bundles, and complete chain presets to speed up multi-panel setup.
**Depends on**: Phase 11.4 (chain push), Phase 11.5 (geo-routing)
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04
**Success Criteria** (what must be TRUE):
  1. Admin can select from VPN protocol templates (VLESS-REALITY, Hysteria2, TUIC, and existing protocols) when configuring a node
  2. Admin can apply server presets for common VPS providers and OS configurations to new panels
  3. Admin can use routing presets (geo rule bundles like Russia Direct, EU Privacy, Full Tunnel) to populate routing rules
  4. Admin can use chain presets that combine chain topology, protocols, and routing rules into a single apply operation
**Plans**: 4 plans (4 waves)

Plans:
- [ ] 11.7-01-PLAN.md -- ChainPreset schema, types, service layer with 3 built-in presets, schema push (Wave 1)
- [ ] 11.7-02-PLAN.md -- Chain preset API routes (CRUD, seed, apply) and server presets (Wave 2)
- [ ] 11.7-03-PLAN.md -- Template gallery page with 4 tabbed grids (Wave 3)
- [ ] 11.7-04-PLAN.md -- Preview modal, save/fork dialogs, navigation entry (Wave 4)

### Phase 11.8: Multi-Panel Dashboard
**Goal**: Central health dashboard aggregates service status, traffic metrics, and alerts from all remote panels into a single overview.
**Depends on**: Phase 11.3 (sync protocol), Phase 11.2 (panel registration)
**Requirements**: DASH-01
**Success Criteria** (what must be TRUE):
  1. Dashboard displays aggregated service status (online/offline/error) for every registered remote panel
  2. Dashboard shows traffic metrics and resource usage pulled from all remote panels in real time
  3. Dashboard surfaces alerts (service failures, quota thresholds, resource thresholds) from all panels in a unified view
**Plans**: 3 plans (3 waves)
**UI hint**: yes

Plans:
- [x] 11.8-01-PLAN.md -- Shared utilities, Collapsible primitive, types, and aggregation API endpoint (Wave 1)
- [x] 11.8-02-PLAN.md -- useMultiPanelStatus hook, FleetHealthStrip, EmptyPanelCTA, PanelCard, PanelCardExpanded (Wave 2)
- [x] 11.8-03-PLAN.md -- MultiPanelSection orchestrator, dashboard page integration, WebSocket events, panel alerts (Wave 3)

### Phase 12.1: Admin API JWT enforcement
**Goal:** All admin-affecting `/api` routes require a valid session/JWT; documented session layer matches implementation (replaces unused `proxy.ts` or wires it).
**Depends on:** v1.0 (Phase 2.3), v1.1 complete
**Requirements:** PROJ-AUTH-01
**Gap closure:** Closes gaps from v1.0 milestone audit (requirement + integration: unauthenticated admin APIs)
**Plans:** 1 plan

Plans:
- [x] 12.1-01-PLAN.md -- JWT middleware for all API routes, cleanup inline auth, remove proxy.ts

### Phase 12.2: Real-time stack (Socket.IO server and clients)
**Goal:** Socket.IO attaches to the HTTP server; `broadcastEvent` delivers; chain status and dashboard hooks use the same protocol as `/api/ws`.
**Depends on:** Phase 12.1 (recommended: secure APIs before widening real-time surface)
**Requirements:** PROJ-RT-01
**Gap closure:** Closes audit gaps on instrumentation, protocol mismatch, and broken live-update flows
**Plans:** 1 plan

Plans:
- [x] 12.2-01 -- Custom server with Socket.IO, protocol fix for use-chain-status, broadcaster start

### Phase 12.3: v1.0 traceability and verification debt
**Goal:** `REQUIREMENTS.md` (or companion doc) maps Phases 1.1-10.4 to checkable outcomes; backfill `VERIFICATION.md` for audit-critical areas; optional Nyquist `*-VALIDATION.md` pilot.
**Depends on:** None (documentation); can parallelize with 12.1/12.2 if resourced
**Requirements:** PROJ-TRACE-01
**Gap closure:** Closes audit gap on missing v1.0 REQ traceability and mass unverified phases (scoped, not all 58 in one pass)
**Plans:** TBD (`/gsd-plan-phase 12.3`)

### Phase 12.4: Remote sync apply path and WS-driven invalidation
**Goal:** Central push/apply path does not rely on missing remote endpoints; dashboard/resource queries invalidate on relevant WebSocket events.
**Depends on:** Phase 11.3-11.4 (sync protocol); Phase 12.2 (for event-driven invalidation)
**Requirements:** GAPL-01, GAPL-02
**Gap closure:** Closes audit integration warnings (config-applier/sync 404 path; polling-only UI)
**Plans:** TBD (`/gsd-plan-phase 12.4`)

### Phase 12.5: Multi-panel push UX integration
**Goal:** Default admin push flow uses signed remote panel push (diff, progress, rollback, actionable errors) and the visual editor shows panel boundaries on the push screen -- closing the split between PushWizard and `ChainFlowEditor` + local `chains/apply` only.
**Depends on:** Phase 11.3-11.6 (sync, push UX implementation, editor); coordinate with Phase 12.4 if remote apply path changes
**Requirements:** CPUSH-01, CPUSH-02, CPUSH-03, CPUSH-04, CPUSH-05, CPUSH-06, CHAIN-01, VISED-03
**Gap closure:** Closes gaps from `.planning/v1.1-MILESTONE-AUDIT.md` (CPUSH/CHAIN/VISED, PushWizard unwired, panel map props)
**Plans:** 1 plan

Plans:
- [x] 12.5-01-PLAN.md -- Mount PushWizard on push page, buildServerPanelMap utility, ChainFlowEditor with panel boundaries (Wave 1)

### Phase 12.6: Geo-routing runtime E2E
**Goal:** GeoIP-based routing evaluation is invoked from the real chain/traffic application path; GEO-04 import path includes sendmiche/rulite (or requirement text is narrowed to match shipped scope).
**Depends on:** Phase 11.5
**Requirements:** GEO-03, GEO-04
**Gap closure:** Closes v1.1 audit gaps (unused `resolveGeoRoute` consumers; missing rulite)
**Plans:** TBD (`/gsd-plan-phase 12.6`)

### Phase 12.7: Tailscale milestone verification
**Goal:** Phase 11.1 meets the same verification standard as later v1.1 phases -- `11.1-VERIFICATION.md` (or equivalent), operator flows for TSCL-01-04; refresh stale verification prose where the audit flagged it (e.g. 11.2).
**Depends on:** Phase 11.1
**Requirements:** TSCL-01, TSCL-02, TSCL-03, TSCL-04
**Gap closure:** Closes v1.1 audit evidence/Nyquist gaps for Tailscale
**Plans:** TBD (`/gsd-plan-phase 12.7`)

### Phase 12.8: Sync apply and receive contracts
**Goal:** Remote apply and receive calls use the same auth headers, payloads, and response shapes the routes implement -- no unsigned `/api/sync/apply` from the config applier and no stale assumptions in `panel-sync-client` for `/api/sync/receive`.
**Depends on:** Phase 12.4 (baseline routes); coordinate with 12.10 for end-to-end push
**Requirements:** GAPL-01, CHAIN-01 (applier <-> `/api/sync/apply` slice)
**Gap closure:** Closes `v12.x-audit-closure-MILESTONE-AUDIT.md` integration gaps (config-applier <-> apply; panel-sync-client <-> receive)
**Plans:** 3 plans (3 waves)

Plans:
- [x] 12.8-01-PLAN.md -- Fix config-applier auth/response parsing, panel-sync-client response parsing, types, and tests (Wave 1)
- [x] 12.8-02-PLAN.md -- Add panelCredentials to chain-router, update chains/apply route, and tests (Wave 2)
- [x] 12.8-03-PLAN.md -- Mock geo-routing in chain-router.test.ts to fix transitive @/lib/prisma import (Wave 3)

### Phase 12.9: WebSocket -> React Query key alignment
**Goal:** WebSocket `broadcastEvent` invalidates the same React Query keys the dashboard, resources, and fleet hooks use so real-time refresh actually refetches UI data.
**Depends on:** Phase 12.2
**Requirements:** GAPL-02, PROJ-RT-01
**Gap closure:** Closes audit gap on `WS_TO_QUERY_KEYS` vs hook key namespaces
**Plans:** 1 plan

Plans:
- [x] 12.9-01-PLAN.md -- Fix WS_TO_QUERY_KEYS mappings and remove dead/duplicate entries (Wave 1)

### Phase 12.10: Push wizard and per-panel sync fixes
**Goal:** Push and rollback send non-empty per-panel API keys; per-panel configs and Xray rules are panel-scoped as designed; push results and errors are trustworthy end-to-end.
**Depends on:** Phase 12.5; **12.8** recommended first (receive/apply contracts)
**Requirements:** CPUSH-01, CPUSH-02, CPUSH-03, CPUSH-04, CPUSH-05, CPUSH-06, VISED-03 (residual)
**Gap closure:** Closes PushWizard / `panel-sync-client` / per-panel scoping gaps from closure audit
**Plans:** 3 plans (1 wave)

Plans:
- [x] 12.10-01-PLAN.md -- Fix generatePerPanelConfig Xray rule panel scoping and update test (Wave 1)
- [x] 12.10-02-PLAN.md -- Add per-panel API key inputs to PushWizard, fix empty key bugs, fix step 4 results (Wave 1)
- [x] 12.10-03-PLAN.md -- Fix chains/apply to accept panelApiKeys, add API key dialog to ChainFlowEditor (Wave 1)

### Phase 12.11: Tailscale transport in chain apply
**Goal:** Chain apply and routing paths that target remote panels use Tailscale/panel URL transport resolution (`resolveTransportAddress` / tailnet APIs), not ad hoc `hostname` with SSH default port.
**Depends on:** Phase 11.1, Phase 12.8 (apply path)
**Requirements:** TSCL-04, CHAIN-01 (transport slice)
**Gap closure:** Closes closure audit gap "transport primitives not wired into active sync/apply paths"
**Plans:** 3 plans (2 waves)

Plans:
- [x] 12.11-01-PLAN.md -- resolvePanelTransport utility with 3-tier fallback and tests (Wave 1)
- [x] 12.11-02-PLAN.md -- Wire transport into chain-router WireGuard endpoints and chain-config route (Wave 2)
- [x] 12.11-03-PLAN.md -- Wire transport into chains/apply route and panel-sync-client push (Wave 2)

### Phase 12.12: 12.x verification artifacts
**Goal:** Missing `*-VERIFICATION.md` for phases 12.1, 12.4, 12.6, 12.7; PROJ-AUTH-01 strict evidence; `REQUIREMENTS.md` body/traceability reconciled with live integration behavior.
**Depends on:** None for documentation-only tasks; run after relevant code phases for evidence
**Requirements:** PROJ-AUTH-01 (verification), GEO-03, GEO-04, TSCL-01-TSCL-04 (artifact refresh as scoped in checklists)
**Gap closure:** Closes `v12.x-audit-closure-MILESTONE-AUDIT.md` process gate (verification inventory)
**Plans:** 3 plans (2 waves) -- Planned 2026-05-02

Plans:
- [x] 12.12-01-PLAN.md -- VERIFICATION.md for phases 12.1 (PROJ-AUTH-01) and 12.4 (GAPL-01, GAPL-02) (Wave 1)
- [x] 12.12-02-PLAN.md -- VERIFICATION.md for phases 12.6 (GEO-03, GEO-04) and 12.7 (TSCL-01-03) (Wave 1)
- [x] 12.12-03-PLAN.md -- VERIFICATION.md for phase 12.11 (TSCL-04) and REQUIREMENTS.md checkbox reconciliation (Wave 2)

## Progress

**Execution Order:**
Phases execute in numeric order: 11.1 -> ... -> 11.8 -> 12.1 -> ... -> 12.12 (12.3 may run in parallel with 12.1/12.2; **12.8** before **12.10**-**12.11** recommended; **12.9** can parallelize with **12.8**)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.6 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 1.7 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 2.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 2.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 2.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 2.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 2.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.6 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 3.7 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.6 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.7 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.8 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 4.9 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.6 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 5.7 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 6.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 6.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 6.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 6.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 6.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.5 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 7.6 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 8.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 8.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 8.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 8.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 9.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 9.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 9.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 9.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 10.1 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 10.2 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 10.3 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 10.4 | v1.0 | 1/1 | Complete | 2026-04-29 |
| 11.1 | v1.1 | 3/3 | Complete | 2026-04-29 |
| 11.2 | v1.1 | 3/3 | Complete | 2026-04-29 |
| 11.3 | v1.1 | 3/3 | Complete | 2026-04-30 |
| 11.4 | v1.1 | 5/5 | Complete | 2026-04-30 |
| 11.5 | v1.1 | 5/5 | Complete | 2026-05-01 |
| 11.6 | v1.1 | 3/3 | Complete | 2026-05-01 |
| 11.7 | v1.1 | 4/4 | Complete | 2026-05-01 |
| 11.8 | v1.1 | 3/3 | Complete | 2026-05-01 |
| 12.1 | v1.0 audit | 1/1 | Complete | 2026-05-01 |
| 12.2 | v1.0 audit | 1/1 | Complete | 2026-05-01 |
| 12.3 | v1.0 audit | 1/1 | Complete | 2026-05-01 |
| 12.4 | v1.0 audit | 1/1 | Complete | 2026-05-01 |
| 12.5 | v1.1 audit | 1/1 | Complete | 2026-05-01 |
| 12.6 | v1.1 audit | 1/1 | Complete | 2026-05-01 |
| 12.7 | v1.1 audit | 1/1 | Complete | 2026-05-01 |
| 12.8 | v12.x closure | 3/3 | Complete | 2026-05-02 |
| 12.9 | v12.x closure | 1/1 | Complete | 2026-05-02 |
| 12.10 | v12.x closure | 3/3 | Complete | 2026-05-02 |
| 12.11 | v12.x closure | 3/3 | Complete | 2026-05-02 |
| 12.12 | v12.x closure | 3/3 | Complete | 2026-05-02 |
| 12.13 | v12.x closure | 0 | Pending | -- |
| 12.14 | v12.x closure | 0 | Pending | -- |
| 12.15 | v12.x closure | 0 | Pending | -- |

## Coverage

v1.0: All 42 requirements mapped and shipped
v1.1: All 35 requirements mapped (see traceability in REQUIREMENTS.md)
v1.0 audit remediation: 5 requirements (PROJ-*, GAPL-*) mapped to Phases 12.1-12.4, with **12.8-12.9** closing residual GAPL-* / PROJ-RT-01 integration per `v12.x-audit-closure-MILESTONE-AUDIT.md`
v1.1 audit gap closure: 15 requirements (CPUSH-*, CHAIN-01, VISED-03, GEO-03, GEO-04, TSCL-*) -- **12.5-12.7** initial delivery; **12.8-12.12** close closure-audit gaps (contracts, push UX, transport, verification)
**Nyquist:** No `*-VALIDATION.md` under `12.*` yet -- optional `/gsd-validate-phase` backlog

---
*Roadmap created: 2026-04-27*
*Last updated: 2026-05-03 - Phase 12.14 planned: 3 plans (2 waves) for 12.6 and 12.7 VERIFICATION artifacts + REQUIREMENTS.md reconciliation*
