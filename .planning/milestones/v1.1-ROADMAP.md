# Roadmap: Amnezia Control Panel

## Milestones

- **v1.0** -- Phases 1.1-10.4 (shipped 2026-04-29)
- **v1.1 Multi-Panel Chain Routing** -- Phases 11.1-11.8 (in progress)

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
- [x] Phase 7.6: Real-time Updates
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

### v1.1 Multi-Panel Chain Routing (In Progress)

**Milestone Goal:** Support multi-panel server chains with geo-routing, Tailscale transport, and pre-configuration templates -- central push model with hybrid autonomy.

- [x] **Phase 11.1: Tailscale Foundation** - Subnet router setup, Tailscale node discovery, transport layer for inter-panel communication
- [x] **Phase 11.2: Remote Panel Registration** - Register, test, monitor, and manage remote panels from central panel
- [x] **Phase 11.3: Panel Sync Protocol & Hybrid Autonomy** - Config push transport, local config caching, and autonomous fallback
- [x] **Phase 11.4: Chain Config Application & Push UX** - Real config push to AWG/3x-ui services, diff preview, rollback, error reporting
- [x] **Phase 11.5: Geo-Routing & Routing Rules**- Persisted geo-routing rules, GeoIP lookups, routing rule CRUD with templates
- [x] **Phase 11.6: Visual Chain Editor** - Drag-and-drop chain topology with panel boundaries and inline rule editing
- [x] **Phase 11.7: Pre-Configuration Templates** - VPN protocol, server, routing, and chain presets ✅ 2026-05-01
- [x] **Phase 11.8: Multi-Panel Dashboard** - Central health dashboard aggregating status from all remote panels ✅ 2026-05-01

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

## Progress

**Execution Order:**
Phases execute in numeric order: 11.1 -> 11.2 -> 11.3 -> 11.4 -> 11.5 -> 11.6 -> 11.7 -> 11.8

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
| 11.5 | v1.1 | 0/5 | Not started | - |
| 11.6 | v1.1 | 0/3 | Not started | - |
| 11.7 | v1.1 | 4/4 | Complete | 2026-05-01 |
| 11.8 | v1.1 | 3/3 | Complete | 2026-05-01 |

## Coverage

v1.0: All 42 requirements mapped and shipped
v1.1: All 35 requirements mapped (see traceability in REQUIREMENTS.md)

---
*Roadmap created: 2026-04-27*
*Last updated: 2026-05-01 - Phase 11.8 complete (3 plans, 3 waves)*
