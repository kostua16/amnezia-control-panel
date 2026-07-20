# Roadmap: Amnezia Control Panel

## Milestones

- **v1.0** -- Phases 1.1-10.4 (shipped 2026-04-29)
- **v1.1 Multi-Panel Chain Routing + Audit Remediation** -- Phases 11.1-12.15 (shipped 2026-06-11) [archive](.planning/milestones/v1.1-ROADMAP.md)
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

<details>
<summary>v1.1 Audit Remediation (Phases 12.1-12.15) -- SHIPPED 2026-06-11</summary>

**Closure audit:** `.planning/v12.x-audit-closure-MILESTONE-AUDIT.md`

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
- [x] **Phase 12.15: Requirements reconciliation & middleware hardening** -- 15+ checkboxes, traceability table, middleware matcher `/panels/:path*` + `/templates/:path*`

</details>

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
**Plans:** 3 plans (2 waves) -- Complete 2026-05-03

Plans:

- [x] 12.14-01-PLAN.md -- Create 12.6-VERIFICATION.md with GEO-03 and GEO-04 evidence (Wave 1)
- [x] 12.14-02-PLAN.md -- Create 12.7-VERIFICATION.md with TSCL-01-03 meta-verification evidence (Wave 1)
- [x] 12.14-03-PLAN.md -- Reconcile REQUIREMENTS.md checkboxes and traceability for GEO-03/04, TSCL-01-03; update v12.x-MILESTONE-AUDIT.md (Wave 2)

### Phase 12.15: Requirements reconciliation & middleware hardening

**Goal:** Reconcile 15+ unchecked REQUIREMENTS.md checkboxes with verified evidence; update stale traceability entries; harden middleware matcher.
**Depends on:** Phase 12.13, Phase 12.14 (VERIFICATION.md must exist before reconciliation)
**Requirements:** GAPL-01, CHAIN-01 (traceability fix); PROJ-AUTH-01 (verification closure)
**Gap closure:** Closes WARNING-1 (middleware matcher), FLOW-6 (verification closure), and REQUIREMENTS.md checkbox debt
**Plans:** Verified against codebase (2026-06-11)

### Next Milestone: Developer automation governance (Phases 13.1-13.4)

- [ ] **Phase 13.1: Workflow governance hardening** -- central policy, maintainer-only triggers, explicit manual-only workflow/planning paths
- [ ] **Phase 13.2: CI and supply-chain correctness** -- deterministic release notes, pinned bootstrap tooling, hard failures for push/build regressions
- [ ] **Phase 13.3: PR finalizer and approval policy** -- signal-only reviews, trusted auto-approval, and controlled auto-merge
- [ ] **Phase 13.4: Claude+GSD planning automation** -- trusted improvement analysis, auto-merged planning intake PRs, and GSD execution queue artifacts
- [ ] **Phase 999: GH planning execution queue** -- imported merged planning artifacts executed by scheduled GSD automation

**Improvement intake from PR automation**
<!-- AUTO-PR-IMPROVE-INTAKE-START -->
<!-- PR-IMPROVE:182 --> - PR #182: fix(audit): address autonomous audit findings -- 13.2 x2, 13.3 x1, 13.4 x1. Quick artifact: `.planning/quick/260603-pr182-workflow-improve/260603-pr182-PLAN.md`.
<!-- PR-IMPROVE:237 --> - PR #237: [codex] fix PR finalizer auto-merge stall -- pr237.1 x1, pr237.2 x1, pr237.3 x1, pr237.4 x1. Quick artifact: `.planning/quick/260605-pr237-workflow-improve/260605-pr237-PLAN.md`.
<!-- PR-IMPROVE:352 --> - PR #352: fix: resolve #347 - Security: esbuild RCE + arbitrary file read (HIGH) and postcss XSS (moderate) -- pr352.1 x1, pr352.2 x1, pr352.3 x1, pr352.4 x1. Quick artifact: `.planning/quick/260612-pr352-workflow-improve/260612-pr352-PLAN.md`.
<!-- PR-IMPROVE:596 --> - PR #596: fix: resolve #544 - [claude-health] CI Claude Issue Tracker -- pr596.2 x1. Quick artifact: `.planning/quick/260702-pr596-workflow-improve/260702-pr596-PLAN.md`.
<!-- PR-IMPROVE:603 --> - PR #603: fix: resolve #601 - feature: enhance review workflow to be able to run rebase with force -- pr603.1 x1, pr603.2 x1. Quick artifact: `.planning/quick/260702-pr603-workflow-improve/260702-pr603-PLAN.md`.
<!-- PR-IMPROVE:640 --> - PR #640: fix(workflows): keep stateful PRs in project-manager scope -- pr640.1 x1, pr640.3 x1. Quick artifact: `.planning/quick/260707-pr640-workflow-improve/260707-pr640-PLAN.md`.
<!-- PR-IMPROVE:645 --> - PR #645: fix(workflows): reconcile stale pending PR checks -- pr645.1 x1, pr645.2 x1, pr645.3 x1. Quick artifact: `.planning/quick/260708-pr645-workflow-improve/260708-pr645-PLAN.md`.
<!-- PR-IMPROVE:647 --> - PR #647: feat: replace sticky workflow comments on refresh -- pr647.1 x1, pr647.2 x1. Quick artifact: `.planning/quick/260708-pr647-workflow-improve/260708-pr647-PLAN.md`.
<!-- PR-IMPROVE:651 --> - PR #651: feat(workflows): add autonomy round 2 recovery flows -- pr651.1 x1, pr651.2 x1, pr651.3 x1, pr651.4 x1. Quick artifact: `.planning/quick/260709-pr651-workflow-improve/260709-pr651-PLAN.md`.
<!-- PR-IMPROVE:660 --> - PR #660: fix(review): collect Kilo review thread feedback -- pr660.1 x1, pr660.2 x1, pr660.3 x1. Quick artifact: `.planning/quick/260710-pr660-workflow-improve/260710-pr660-PLAN.md`.
<!-- PR-IMPROVE:683 --> - PR #683: fix: resolve #679 - [todo-backlog] audit-auto-prs: optimize/audit review backlog (APR) -- pr683.2 x3. Quick artifact: `.planning/quick/260712-pr683-workflow-improve/260712-pr683-PLAN.md`.
<!-- PR-IMPROVE:690 --> - PR #690: fix(workflows): never auto-close umbrella/tracking issues from automation -- pr690.1 x1, pr690.2 x1. Quick artifact: `.planning/quick/260712-pr690-workflow-improve/260712-pr690-PLAN.md`.
<!-- PR-IMPROVE:692 --> - PR #692: fix: partial #680 - [todo-backlog] security-audit-weekly: optimize/audit review backlog (SEC) -- pr692.1 x1, pr692.2 x1. Quick artifact: `.planning/quick/260712-pr692-workflow-improve/260712-pr692-PLAN.md`.
<!-- PR-IMPROVE:715 --> - PR #715: fix(workflows): prevent PR flow wedging at flow/checks-pending -- pr715.1 x1, pr715.2 x1, pr715.3 x1. Quick artifact: `.planning/quick/260712-pr715-workflow-improve/260712-pr715-PLAN.md`.
<!-- PR-IMPROVE:719 --> - PR #719: fix: resolve #714 - APR-E01: Weekly human-disposition digest issue (audit-auto-prs) -- pr719.1 x1, pr719.2 x1. Quick artifact: `.planning/quick/260712-pr719-workflow-improve/260712-pr719-PLAN.md`.
<!-- PR-IMPROVE:720 --> - PR #720: fix: resolve #708 - WHO-I05: Lighten the hourly collect job (workflow-health-optimize) -- pr720.1 x1, pr720.2 x1. Quick artifact: `.planning/quick/260712-pr720-workflow-improve/260712-pr720-PLAN.md`.
<!-- PR-IMPROVE:721 --> - PR #721: fix: resolve #703 - MON-I01: Catch timeout-cancelled runs in 'report-failure' (monitor-github-runs) -- pr721.1 x1, pr721.2 x1. Quick artifact: `.planning/quick/260712-pr721-workflow-improve/260712-pr721-PLAN.md`.
<!-- PR-IMPROVE:722 --> - PR #722: fix: resolve #704 - MON-I02: Align 80-turn budget with the 25-min timeout (monitor-github-runs) -- pr722.1 x1, pr722.2 x1, pr722.4 x1. Quick artifact: `.planning/quick/260712-pr722-workflow-improve/260712-pr722-PLAN.md`.
<!-- PR-IMPROVE:750 --> - PR #750: fix(workflows): persist maintenance pruning changes -- pr750.1 x1, pr750.2 x1. Quick artifact: `.planning/quick/260714-pr750-workflow-improve/260714-pr750-PLAN.md`.
<!-- PR-IMPROVE:753 --> - PR #753: fix: resolve #749 - APR-I05: Fix the empty "Auto PR audit report" evidence section in PR bodies (audit-auto-prs) -- pr753.1 x1, pr753.2 x1. Quick artifact: `.planning/quick/260714-pr753-workflow-improve/260714-pr753-PLAN.md`.
<!-- PR-IMPROVE:754 --> - PR #754: fix: resolve #731 - WHO-E01: Persist per-run health summaries for trend analysis (workflow-health-optimize) -- pr754.2 x2. Quick artifact: `.planning/quick/260714-pr754-workflow-improve/260714-pr754-PLAN.md`.
<!-- PR-IMPROVE:761 --> - PR #761: fix: resolve #760 - [project-manager] PR #751 fix-review.yml failed for 4b2302219fed -- pr761.2 x2. Quick artifact: `.planning/quick/260714-pr761-workflow-improve/260714-pr761-PLAN.md`.
<!-- PR-IMPROVE:768 --> - PR #768: fix: resolve #766 - WHO-I03: Make 50KB 'runs_data' truncation JSON-safe (workflow-health-optimize) -- pr768.2 x1. Quick artifact: `.planning/quick/260715-pr768-workflow-improve/260715-pr768-PLAN.md`.
<!-- PR-IMPROVE:775 --> - PR #775: fix(workflows): let pr-flow / project-manager actually push stuck PRs to merge -- pr775.1 x1, pr775.2 x1, pr775.3 x1. Quick artifact: `.planning/quick/260716-pr775-workflow-improve/260716-pr775-PLAN.md`.
<!-- PR-IMPROVE:777 --> - PR #777: fix(workflows): wake and rescue PRs whose finalizer apply failed -- pr777.2 x1, pr777.3 x1. Quick artifact: `.planning/quick/260716-pr777-workflow-improve/260716-pr777-PLAN.md`.
<!-- PR-IMPROVE:780 --> - PR #780: fix(workflows): repair the triage→fix pipeline and add automations that catch stranded issues -- pr780.1 x1, pr780.2 x1. Quick artifact: `.planning/quick/260717-pr780-workflow-improve/260717-pr780-PLAN.md`.
<!-- PR-IMPROVE:781 --> - PR #781: fix: resolve #779 - WHO-I04: Exclude self by workflow path, not display name (workflow-health-optimize) -- pr781.1 x1. Quick artifact: `.planning/quick/260717-pr781-workflow-improve/260717-pr781-PLAN.md`.
<!-- PR-IMPROVE:802 --> - PR #802: fix(workflows): route parked dead letters to retry before priority escalation -- pr802.1 x1, pr802.2 x1, pr802.3 x1. Quick artifact: `.planning/quick/260718-pr802-workflow-improve/260718-pr802-PLAN.md`.
<!-- PR-IMPROVE:810 --> - PR #810: test(workflows): pin ensured workflow labels to policy.json definitions -- pr810.1 x1, pr810.2 x1. Quick artifact: `.planning/quick/260718-pr810-workflow-improve/260718-pr810-PLAN.md`.
<!-- PR-IMPROVE:824 --> - PR #824: fix: resolve #748 - MON-I05: Anchor the monitor window to scheduled runs only (monitor-github-runs) -- pr824.1 x1, pr824.2 x1. Quick artifact: `.planning/quick/260719-pr824-workflow-improve/260719-pr824-PLAN.md`.
<!-- PR-IMPROVE:825 --> - PR #825: fix: resolve #820 - [audit-auto-prs] Auto PR audit workflow failed -- pr825.2 x2. Quick artifact: `.planning/quick/260719-pr825-workflow-improve/260719-pr825-PLAN.md`.
<!-- PR-IMPROVE:826 --> - PR #826: fix: resolve #813 - APR-E02: File-overlap conflict matrix artifact (audit-auto-prs) -- pr826.1 x1, pr826.2 x1, pr826.3 x1. Quick artifact: `.planning/quick/260719-pr826-workflow-improve/260719-pr826-PLAN.md`.
<!-- PR-IMPROVE:837 --> - PR #837: fix: resolve #834 - AFX-I04: Trim the plugin list to the audit mission (audit-fix) -- pr837.1 x1, pr837.2 x2. Quick artifact: `.planning/quick/260719-pr837-workflow-improve/260719-pr837-PLAN.md`.
<!-- PR-IMPROVE:839 --> - PR #839: fix(workflows): honest restored-only fix-review reports + maintainer opt-in for protected .github/actions edits -- pr839.1 x1, pr839.2 x1, pr839.3 x1. Quick artifact: `.planning/quick/260719-pr839-workflow-improve/260719-pr839-PLAN.md`.
<!-- PR-IMPROVE:843 --> - PR #843: fix: resolve #699 - MNT-I03: Align 50-turn budget with the 10-min timeout (maintenance) -- pr843.1 x1, pr843.2 x1. Quick artifact: `.planning/quick/260719-pr843-workflow-improve/260719-pr843-PLAN.md`.
<!-- PR-IMPROVE:846 --> - PR #846: fix: resolve #840 - MON-I06: Review the 'claude-workflow-optimize-' trust-prefix interplay (monitor-github-runs) -- pr846.1 x1, pr846.2 x1. Quick artifact: `.planning/quick/260719-pr846-workflow-improve/260719-pr846-PLAN.md`.
<!-- PR-IMPROVE:849 --> - PR #849: fix(workflows): AFX-I04 plugin trim + security-guidance in pattern-rules-only mode (audit-fix) -- pr849.1 x1, pr849.2 x2. Quick artifact: `.planning/quick/260719-pr849-workflow-improve/260719-pr849-PLAN.md`.
<!-- PR-IMPROVE:863 --> - PR #863: fix: resolve #707 - WHO-I02: Bound failure-log collection in 'collect-runs' (workflow-health-optimize) -- pr863.2 x2. Quick artifact: `.planning/quick/260720-pr863-workflow-improve/260720-pr863-PLAN.md`.
<!-- AUTO-PR-IMPROVE-INTAKE-END -->

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

**Goal:** Turn qualifying PRs into planning intake artifacts, auto-merge those artifacts after review signals, and queue merged artifacts for scheduled GSD execution.
**Depends on:** Phase 13.1, Phase 13.3
**Requirements:** Trusted planning automation and roadmap intake capture
**Plans:** Seeded in `.planning/phases/13.4-claude-gsd-planning-automation/13.4-PLAN.md`

### Phase 999: GH planning execution queue

**Goal:** Store canonical execution plans imported from merged `.planning/quick/**` artifacts.
**Depends on:** Phase 13.4
**Requirements:** One imported artifact per wave so the scheduled executor can process up to four plans per day.
**Plans:** 28/35 plans executed

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
- [x] 11.5-04-PLAN.md -- Routing rules UI: tabs, geo rules list, geo rule drawer, GeoIP status badge (Wave 3)
- [x] 11.5-05-PLAN.md -- Templates library, geoip.dat import, template gallery, starter rules (Wave 3)

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

- [x] 11.7-01-PLAN.md -- ChainPreset schema, types, service layer with 3 built-in presets, schema push (Wave 1)
- [x] 11.7-02-PLAN.md -- Chain preset API routes (CRUD, seed, apply) and server presets (Wave 2)
- [x] 11.7-03-PLAN.md -- Template gallery page with 4 tabbed grids (Wave 3)
- [x] 11.7-04-PLAN.md -- Preview modal, save/fork dialogs, navigation entry (Wave 4)

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
| 12.1 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.2 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.3 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.4 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.5 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.6 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.7 | v1.1 | 1/1 | Complete | 2026-05-01 |
| 12.8 | v1.1 | 3/3 | Complete | 2026-05-02 |
| 12.9 | v1.1 | 1/1 | Complete | 2026-05-02 |
| 12.10 | v1.1 | 3/3 | Complete | 2026-05-02 |
| 12.11 | v1.1 | 3/3 | Complete | 2026-05-02 |
| 12.12 | v1.1 | 3/3 | Complete | 2026-05-02 |
| 12.13 | v1.1 audit | 2/2 | Complete | 2026-05-03 |
| 12.14 | v1.1 audit | 3/3 | Complete | 2026-05-03 |
| 12.15 | v1.1 audit | 1/1 | Complete | 2026-06-11 |

## Coverage

v1.0: All 42 requirements mapped and shipped
v1.1: All 35 requirements mapped + 20 audit remediation requirements (PROJ-*, GAPL-*, CPUSH-*, CHAIN-01, VISED-03, GEO-*, TSCL-*) shipped across Phases 11.1-12.15
**Nyquist:** No `*-VALIDATION.md` under `12.*` yet -- optional `/gsd-validate-phase` backlog

## Improvement Intake: Architectural Review (2026-06-10)

Source: `/gsd:explore` deep architectural review. Artifact: `.planning/quick/260610-arch-review-improvements/260610-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 1 | **GeoIP lookup optimization** — Replace O(n) CIDR linear scan with sorted table + binary search (O(log n)) | High (Perf) | `src/lib/geoip-manager.ts` | Proposed |
| 2 | **API route handler abstraction** — `withHandler(schema, handler)` wrapper to eliminate duplicated try/catch + Zod + P2002 boilerplate across ~30 route files | Medium (DRY) | `src/lib/api-handler.ts` (new), `src/app/api/**/*.ts` | Proposed |
| 3 | **Broadcaster query optimization** — Add time-range filter to `trafficLog.aggregate()`, reduce user count queries | Medium (Perf) | `src/lib/real-time-broadcaster.ts` | Proposed |

## Improvement Intake: Deep Architectural Review (2026-06-11)

Source: `/gsd:explore` second-pass review (non-duplicative). Artifact: `.planning/quick/260611-arch-review-deep/260611-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 4 | **Transaction boundaries for user lifecycle** — Wrap POST/PUT/DELETE multi-step DB+VPN writes in `prisma.$transaction()` to prevent partial-failure inconsistency | High (Consistency) | `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts` | Proposed |
| 5 | **Decompose vpn-services.ts** — Split 791-line god file into `vpn/cli-executor`, `vpn/validation`, `vpn/awg-service`, `vpn/xui-service`, `vpn/types` (all under 200 lines) | Medium (Maintainability) | `src/lib/vpn-services.ts` → `src/lib/vpn/*.ts` | Proposed |
| 6 | **Composite index on TrafficLog** — Add `@@index([userId, timestamp])` so traffic stats queries use a single index scan instead of choosing between two single-column indexes | Medium (Perf) | `prisma/schema.prisma` | Proposed |

## Improvement Intake: Architectural Review Pass 3 (2026-06-12)

Source: `/gsd:explore` third-pass review (non-duplicative). Artifact: `.planning/quick/260612-arch-review/260612-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 7 | **Audit log raw SQL → Prisma model** — Remove raw `CREATE TABLE IF NOT EXISTS` + `$executeRaw` in `audit-log.ts`; use `prisma.auditLog.create()` against the existing model/migration, eliminating dead-code dual schema | Medium (Consistency) | `src/lib/audit-log.ts` | Proposed |
| 8 | **Extract bcrypt hashing utility** — Replace 5+ repeated `await import('bcryptjs'); bcrypt.hash(...)` inline patterns with a `hashSecret()`/`verifySecret()` utility in `lib/crypto.ts` | Low-Medium (DRY) | `src/lib/crypto.ts` (new), 5 route files | Proposed |
| 9 | **Async service-monitor** — Replace `execFileSync` (sync, blocks event loop up to 15s) with `execFileAsync` in `service-monitor.ts`, matching the async pattern already used in `vpn-services.ts` | Medium (Perf) | `src/lib/service-monitor.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 4 (2026-06-13)

Source: `/gsd:explore` fourth-pass review (non-duplicative). Artifact: `.planning/quick/260613-arch-review/260613-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 10 | **Deduplicate chain config generation** — `generateWireGuardPeers` and `generateXrayRoutingRules` are each implemented twice (chain-router.ts + chain-config/route.ts) with behavioral drift: mesh topology uses `direct` vs `mesh_balancer`, split topology omits geoip rules in one copy, linear priorities differ (0 vs per-node). Extract into shared `chain-config-generator.ts`; resolve drift per topology | High (Correctness) | `src/lib/chain-router.ts`, `src/app/api/panels/push/chain-config/route.ts` → `src/lib/chain-config-generator.ts` (new) | Proposed |
| 11 | **Config-applier shared push helper** — `applyAwgConfig()` and `applyThreeXuiConfig()` share ~80% identical code (fetch + HMAC signing + timeout + error handling + 404 handling). Extract `pushToRemotePanel()` helper; thin wrappers per service | Medium (DRY) | `src/lib/config-applier.ts` | Proposed |
| 12 | **Resource-monitor async conversion** — Extends proposal 9 scope: `execFileSync('df', ...)` and `execFileSync('powershell', ...)` in `resource-monitor.ts` block the event loop up to 5s. Convert to `execFileAsync` matching vpn-services.ts pattern | Medium (Perf) | `src/lib/resource-monitor.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 5 (2026-06-22)

Source: `/gsd:explore` fifth-pass review (non-duplicative). Artifact: `.planning/quick/260622-arch-review-pass5/260622-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 13 | **Missing server-side service lifecycle** — `startBroadcaster()`, `geoIPManager.init()`, and `ServiceMonitor` are never initialized in production. No `instrumentation.ts` exists. Real-time dashboard updates and geo-routing lookups are functionally broken in the custom `server.mjs` deployment path. Fix: add `src/instrumentation.ts` (Next.js stable API) to wire all orphaned singletons at server startup. | Critical (Runtime) | `server.mjs`, `src/instrumentation.ts` (new), `src/lib/real-time-broadcaster.ts`, `src/lib/geoip-manager.ts`, `src/lib/service-monitor.ts` | Proposed |
| 14 | **`server-connection.ts` is a non-functional stub** — `executeOnServer()` logs "Would execute on remote server" and returns empty success. No SSH, no real command execution. Multi-server management (Phases 8.1–8.4) silently does nothing on remote servers. Fix: implement `RemoteExecutor` interface with `ssh2`-based production impl. | High (Correctness) | `src/lib/server-connection.ts` (rewrite), `src/lib/remote-executor.ts` (new), `src/lib/vpn-services.ts`, `package.json` | Proposed |
| 15 | **Panel sync API key lookup is O(n) bcrypt** — `POST /api/sync/receive` loads all active panels and iterates `bcrypt.compare()` per panel. With N panels, each sync costs O(N × 100ms). Fix: add `apiKeyFastHash` (SHA-256) column for O(1) indexed pre-filter, then bcrypt-verify single match. | Medium (Perf) | `prisma/schema.prisma`, `src/app/api/sync/receive/route.ts`, `src/app/api/panels/route.ts`, `src/app/api/panels/[id]/route.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 6 (2026-06-24)

Source: `/gsd:explore` sixth-pass review (non-duplicative). Artifact: `.planning/quick/260624-arch-review-pass6/260624-PLAN.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 16 | **SQLite WAL mode** — `PrismaBetterSqlite3` initialized without WAL; rollback journal locks entire DB on every write. Fix: append `?journal_mode=WAL` to DATABASE_URL or set via pragma after connection. | High (Perf) | `src/lib/prisma.ts` | Proposed |
| 17 | **Security response headers** — Zero security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) set anywhere. Fix: add header defaults via Next.js middleware. | Medium (Security) | `src/middleware.ts` (new/extend) | Proposed |
| 18 | **Bounded parallelism for VPN service loops** — User delete and user-sync iterate VPN API calls sequentially in `for` loops. Fix: `Promise.allSettled` for parallel execution with partial-failure tolerance. | Medium (Perf) | `src/app/api/users/[id]/route.ts`, `src/lib/user-sync.ts` | Proposed |

## Improvement Intake: Consolidated Review Archive (2026-06-17 to 2026-06-21)

Source: consolidated follow-up for PRs #438, #455, and #471. PR #476 was already merged and remains indexed in the 2026-06-22 pass above.

Artifacts:

- `.planning/quick/260617-arch-review/260617-PLAN.md`
- `.planning/quick/260619-arch-review-login-rate-limit/proposal.md`
- `.planning/quick/260619-arch-review-panel-push-batch/proposal.md`
- `.planning/quick/260619-arch-review-tailscale-dedup/proposal.md`
- `.planning/quick/260621-arch-review-pass5/260621-PLAN.md`

Notes:

- Review corrections are folded into the artifacts: Prisma SQLite enum enforcement, Tailscale command/math framing, panel retry worst-case timing, and duplicate Impact bullets.
- This archive intentionally does not renumber backlog proposals because several historical artifacts reuse numbers or overlap with already-indexed roadmap entries.

## Improvement Intake: Architectural Review Pass 7 (2026-07-01)

Source: `/gsd:explore` seventh-pass review (non-duplicative). Artifact: `.planning/quick/260701-arch-review-pass7/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 19 | **SQLite automated backup strategy** — Zero backup mechanism for single-file SQLite DB; add `better-sqlite3.backup()` + daily scheduled backup via instrumentation.ts so admin has a restore path after corruption | Medium (Ops) | `src/lib/db-backup.ts` (new), `src/instrumentation.ts` | Proposed |
| 20 | **JWT sliding-session window** — Hard 24h expiry with no refresh; admin loses unsaved work on mid-session expiry. Fix: re-issue JWT in proxy.ts when ≤ 4h remaining (transparent to frontend) | Medium (UX/Security) | `src/proxy.ts`, `src/app/api/auth/login/route.ts` | Proposed |
| 21 | **CSP nonce-based hardening** — CSP allows `unsafe-inline` and `unsafe-eval`, negating XSS protection. Fix: remove `unsafe-eval` immediately; add per-request nonce for `script-src` to actually block code injection | Low-Medium (Security) | `src/proxy.ts`, `src/app/layout.tsx` | Proposed |

## Improvement Intake: Architectural Review Pass 8 (2026-07-02)

Source: `/gsd:explore` eighth-pass review (non-duplicative vs open PRs and proposals #1-#21). Artifact: `.planning/quick/260702-arch-review-pass8/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 22 | **Dead WebSocket broadcast bridge** — `broadcastEvent()` checks module-local `ioInstance` (never set) instead of `globalThis.__socketIO` (set by server.mjs). All real-time push (stats, resources, alerts, push progress, fallback changes) silently no-ops even though instrumentation.ts now starts the broadcaster. Fix: read from `globalThis.__socketIO` | Critical (Runtime) | `src/lib/websocket.ts`, `server.mjs` | Proposed |
| 23 | **Component mutations bypass React Query cache** — 20+ components use raw `fetch()` for POST/PUT/DELETE instead of `useMutation` hooks. No `onSuccess` cache invalidation; data stays stale up to 30s after user actions. Fix: extract mutation hooks with `httpClient` + `onSuccess` invalidation | Medium (UX) | `src/components/**/*.tsx`, `src/hooks/` (new) | Proposed |
| 24 | **Redundant panel health probing** — Periodic health checker (30s) AND `GET /api/panels/status` (polled 30s by frontend) both run independent HTTP HEAD probes per panel. ~4 requests/panel/30s. Fix: status API reads from checker's cached snapshot instead of re-probing | Medium (Perf) | `src/lib/panel-health-checker.ts`, `src/app/api/panels/status/route.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 9 (2026-07-03)

Source: `/gsd:explore` ninth-pass review (non-duplicative vs proposals #1-#24 and open PRs). Artifact: `.planning/quick/260703-arch-review-pass9/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 25 | **Alert table unbounded growth** — No retention cleanup; quota alerts alone generate 150+/month with no expiry. Add `cleanupOldAlerts()` with configurable `ALERT_RETENTION_DAYS` (default 90), wired into broadcaster daily cycle alongside traffic-log cleanup | Medium (Ops) | `src/lib/alert-service.ts`, `src/lib/real-time-broadcaster.ts` | Proposed |
| 26 | **Broken CIDR matching in `enforceXrayRules`** — `destIp.startsWith(rule.value.split('/')[0'))` is string prefix, not subnet matching. `192.168.1.0/24` falsely matches `192.168.10.0`; `10.0.0.0/8` misses `10.1.2.3`. Replace with proper `ipaddr.js` CIDR subnet check | High (Correctness) | `src/lib/rule-enforcement.ts:31` | Proposed |
| 27 | **Geo-routing rule DB cache** — `evaluateGeoRulesFromDB()` does full `findMany` per resolution. With 100+ imported rules, every geo-route lookup re-scans the active rule set. Add 60s TTL in-memory cache, invalidate on rule CRUD | Medium (Perf) | `src/lib/geo-routing.ts:104` | Proposed |

## Improvement Intake: Architectural Review Pass 10 (2026-07-04)

Source: `/gsd:explore` tenth-pass review (non-duplicative vs proposals #1-#27 and open PRs). Artifact: `.planning/quick/260704-arch-review-pass10/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 28 | **Remove dead PanelConnectionHistory model** — Zero `create()` calls; two read queries wrapped in "table may not exist" catch blocks; health checker uses in-memory snapshot instead. Remove model, relation, indexes, and dead reads | Low (Cleanup) | `prisma/schema.prisma`, `src/lib/panel-health-checker.ts`, `src/app/api/panels/[id]/status/route.ts` | Proposed |
| 29 | **Config import payload size guard** — Unbounded JSON arrays accepted via multipart/raw body; no max entries cap; 10k-entry import → 20k sequential DB queries. Add `MAX_IMPORT_ENTRIES` (500) + 5 MB file size limit | Medium (Ops/Security) | `src/app/api/configs/import/route.ts`, `src/lib/config-import.ts` | Proposed |
| 30 | **Unique constraint on Configuration.name** — Import dedup uses `findFirst` by name but schema lacks `@unique`; duplicate names make import idempotency unreliable. Add unique index + switch to `findUnique` | Low-Medium (Correctness) | `prisma/schema.prisma`, `src/lib/config-import.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 11 (2026-07-05)

Source: `/gsd:explore` eleventh-pass review (non-duplicative vs proposals #1-#30 and open PRs). Artifact: `.planning/quick/260705-arch-review-pass11/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 31 | **Quota monitor N+1 → batch queries** — Replace 200 sequential per-user queries per 5-min tick with 2 batch queries (grouped traffic aggregate + batch alert duplicate check) | High (Perf) | `src/lib/quota-monitor.ts` | Proposed |
| 32 | **Missing `Alert.type` index** — `checkQuotaThreshold()` queries by `type` with no index; add `@@index([type])` to Alert model for index-scan duplicate detection | Medium (Perf) | `prisma/schema.prisma` | Proposed |
| 33 | **Graceful shutdown gaps: prisma disconnect + WebSocket close** — Repo-root `instrumentation.ts` already registers SIGTERM/SIGINT handlers calling stopBroadcaster/cleanupPanelHealth/cleanupConnections/cleanupGeoIP; only `prisma.$disconnect()` and WebSocket `close()` are missing. Extend the existing handler | Medium (Reliability) | `instrumentation.ts` (extend) | Proposed |

## Improvement Intake: Architectural Review Pass 12 (2026-07-08)

Source: `/gsd:explore` twelfth-pass review (non-duplicative vs proposals #1-#33 and open PRs). Artifact: `.planning/quick/260708-arch-review-pass12/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 34 | **No CSRF protection for state-changing API routes** — `sameSite: 'lax'` cookie does not protect POST/PUT/DELETE from cross-site form submissions. Fix: Origin header validation in middleware or double-submit cookie pattern | Medium (Security) | `src/app/api/auth/login/route.ts`, `src/middleware.ts` | Proposed |
| 35 | **Server-timezone-dependent traffic aggregation boundary** — `quota-monitor.ts` computes the month-start boundary with local TZ, not UTC/admin TZ (the dashboard `TRAFFIC_STATS_WINDOW_HOURS` window is relative and unaffected). Fix: UTC-based boundaries or configurable `PANEL_TIMEZONE` env var | Medium (Correctness) | `src/lib/quota-monitor.ts:133`, `src/lib/traffic-log-cleanup.ts` | Proposed |

## Improvement Intake: Architectural Review Pass 13 (2026-07-10)

Source: `/gsd:explore` thirteenth-pass review (non-duplicative vs proposals #1-#35 and open PRs). Artifact: `.planning/quick/260710-arch-review-pass13/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 36 | **Whitelist entries stored in-memory** — Module-level `Array<>` with literal TODO comment; data lost on every restart. Add `WhitelistEntry` Prisma model, replace in-memory CRUD with DB queries | Critical (Data Loss) | `src/app/api/routing/whitelist/route.ts:14-24` | Proposed |
| 37 | **TOCTOU race in sync/receive config versioning** — `storePreviousConfig` + `update` as separate ops; concurrent pushes silently discard rollback chain entries. Wrap in `prisma.$transaction()` | High (Consistency) | `src/app/api/sync/receive/route.ts:184-208` | Proposed |

## Improvement Intake: Architectural Review Pass 14 (2026-07-12)

Source: `/gsd:explore` fourteenth-pass review (non-duplicative vs proposals #1-#37 and open PRs). Artifact: `.planning/quick/260712-arch-review-pass14/proposal.md`

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 38 | **ConfigTemplate missing `@unique` on `name`** — `ConfigTemplate` schema has no unique constraint on `name`; `config-import.ts` uses `findFirst` (not `findUnique`), so duplicate template names are silently created and import idempotency is unreliable. Add `@unique` to `ConfigTemplate.name` and switch to `findUnique`. Distinct from #30 (Configuration.name, already fixed). | Medium (Correctness) | `prisma/schema.prisma:147`, `src/lib/config-import.ts:184` | Proposed |
| 39 | **Config import N+1 sequential queries** — `importConfigurationList` and `importTemplateList` loop each entry doing individual `findUnique` + `create`/`update` (up to 1000 sequential DB round-trips for 500 entries). Pre-load all existing names in one query, then batch-create new entries; individual updates for changed entries only. | Medium (Perf) | `src/lib/config-import.ts:53-133`, `src/lib/config-import.ts:137-236` | Proposed |
| 40 | **No `loading.tsx` files in App Router** — Zero `loading.tsx` files exist in `src/app/`. Next.js App Router uses these to show Suspense-based skeleton/spinner states during route transitions. Users see blank flashes on every navigation instead of structured loading feedback. Add `loading.tsx` with skeleton UI to each dashboard segment route. | Low-Medium (UX) | `src/app/(dashboard)/**/loading.tsx` (new) | Proposed |

## Improvement Intake: Architectural Review Pass 15 (2026-07-14)

Source: `/gsd:explore` fifteenth-pass review (non-duplicative vs proposals #1-#40 and open PRs). Artifact: `.planning/quick/260714-arch-review-pass15/proposal.md`

Also documents 8 previously proposed items now confirmed implemented in codebase (proposals #12, #20, #22, #26, #31, #33, #37, #40).

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 41 | **Panel health checker re-entrant interval guard** — `setInterval` async callback has no inflight guard; slow panels cause overlapping cycles, duplicate probes, and cache races. Fix: add `inflightHealthCheck` promise guard matching `resource-monitor.ts` pattern | Medium (Reliability) | `src/lib/panel-health-checker.ts:356` | Proposed |
| 42 | **Remove dead `execCommandSync` production export** — Export only used in tests; no production consumer. Misleading API surface contradicts async-first convention | Low (Cleanup) | `src/lib/command-executor.ts:150-169` | Proposed |
| 43 | **`generateXrayRulesFromDB` type inference for domain rules** — Non-xray protocol rules default to `type: 'ip'` regardless of destination format. Domain-based geo-site rules pass through `matchesCIDR()` which always returns false, silently bypassing all domain routing | Medium (Correctness) | `src/lib/rule-enforcement.ts:59-61` | Proposed |

## Improvement Intake: Architectural Review Pass 16 (2026-07-20)

Source: `/gsd:explore` sixteenth-pass review (non-duplicative vs proposals #1-#43 and open PRs). Artifact: `.planning/quick/260720-arch-review-pass16/proposal.md`

Deduped vs open PRs: #854 (auto-PR audit), #852 (stale automation-PR close-list), #850/#815/#795 (maintenance persists), #827 (report-failure path for infra errors) — all workflow/automation, no source overlap.

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 44 | **`servers/[id]/config` PUT non-atomic multi-table update** — Server fields updated via `prisma.server.update()` then service overrides iterated in a for-loop with individual `prisma.service.update()` calls. No `prisma.$transaction()`. Failure mid-loop leaves server partially updated (e.g., port changed but service N's override skipped). Distinct from #4 which targets `users/[id]/route.ts`; this route (`servers/[id]/config/route.ts:87-228`) has the same class of bug in a different endpoint family. Fix: wrap the entire server+service update block in a single transaction | Medium (Consistency) | `src/app/api/servers/[id]/config/route.ts:131-164` | Proposed |
| 45 | **Audit log fire-and-forget loses compliance trail** — `writeAuditLog()` (`src/lib/audit-log.ts:14-29`) catches every `prisma.auditLog.create()` error and only logs to `console.error`. If the `audit_logs` table is corrupted, the WAL checkpoint stalls, or disk is full, ALL audit events (login, user changes, config pushes, sync receives) silently vanish with no admin-visible signal. For a panel managing VPN users and security configs this is a compliance gap. Fix: (1) surface consecutive audit-write failures as Alert records visible in the dashboard; (2) add an audit-health check to the broadcaster cycle that flags >N consecutive failures | Medium (Security/Compliance) | `src/lib/audit-log.ts:26-28` | Proposed |
| 46 | **~20 API routes bypass `apiHandler` — missing Prisma error classification** — Routes like `servers/[id]/config`, `users/[id]`, `routing/rules`, `sync/receive`, `whitelist`, `tailscale/*`, `sync/apply`, `sync/status` use manual try/catch. These don't get `apiHandler`'s Prisma P2025→404 or P2002→409 auto-mapping. Example: `servers/[id]/config` line 213-226 handles P2002 manually but returns 409 with `success: false` shape while `apiHandler`-wrapped routes use `error()` from `api-response.ts` — shapes match but the classification is duplicated and fragile (add a new Prisma code to `apiHandler` and 20 routes don't benefit). Fix: migrate remaining routes to `apiHandler`; extract any route-specific P2002 handling into `apiHandler`'s `toErrorResponse` via a per-label override map | Medium (Maintainability) | `src/app/api/servers/[id]/config/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/routing/rules/route.ts` + ~17 others | Proposed |

---
*Roadmap created: 2026-04-27*
*Last updated: 2026-07-20 - Added architectural review pass 16 (proposals #44-#46: servers/config non-atomic update, audit log fire-and-forget, apiHandler migration completeness)*
