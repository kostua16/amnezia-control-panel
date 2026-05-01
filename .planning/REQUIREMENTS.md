# Requirements: Amnezia Control Panel

**Defined:** 2026-04-29
**Core Value:** One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching

## v1.0 Requirements

Requirements for the initial single-panel release. All shipped 2026-04-29. Each maps to roadmap phases.

### Project Setup

- [x] **V1-INIT-01**: Project initialized with Next.js 15 + React 19 + TypeScript + Prisma + SQLite (Phase 1.1)
- [x] **V1-INIT-02**: Core dependencies installed (Socket.IO, Tailwind CSS, Zustand, React Query, bcryptjs, jose) (Phase 1.2)
- [x] **V1-INIT-03**: Database schema with User, Server, and 7 additional models defined via Prisma (Phase 1.3)
- [x] **V1-INIT-04**: Project structure with feature-based component dirs, types, API routes, and lib utilities (Phase 1.4)
- [x] **V1-INIT-05**: Dev environment configured with ESLint, environment variables, seed script (Phase 1.5)
- [x] **V1-INIT-06**: Dashboard layout with sidebar navigation, header, and responsive shell (Phase 1.6)
- [x] **V1-INIT-07**: Login page UI with email/password form (Phase 1.7)

### Authentication

- [x] **V1-AUTH-01**: Authentication context (Zustand store) manages user state, login, logout, and auth check (Phase 2.1)
- [x] **V1-AUTH-02**: Login API endpoint validates credentials via bcryptjs and returns JWT in httpOnly cookie (Phase 2.2)
- [x] **V1-AUTH-03**: Session management with JWT verification middleware on protected routes (Phase 2.3)
- [x] **V1-AUTH-04**: Protected routes redirect unauthenticated users to login (Phase 2.4)
- [x] **V1-AUTH-05**: Logout clears session cookie and resets auth state (Phase 2.5)

### Service Management

- [x] **V1-SVC-01**: Service status API reports online/offline/error for AWG and 3x-ui services (Phase 3.1)
- [x] **V1-SVC-02**: Status display component shows service health in the UI with visual indicators (Phase 3.2)
- [x] **V1-SVC-03**: Service install API for AWG (stub — placeholder for real CLI on deployment server) (Phase 3.3)
- [x] **V1-SVC-04**: Service install API for 3x-ui (stub — placeholder for real CLI on deployment server) (Phase 3.4)
- [x] **V1-SVC-05**: Service uninstall APIs for AWG and 3x-ui (stubs) (Phase 3.5)
- [x] **V1-SVC-06**: Auto-restart logic monitors service health and restarts failed services (Phase 3.6)
- [x] **V1-SVC-07**: Configuration display shows current AWG and 3x-ui settings (Phase 3.7)

### User Management

- [x] **V1-USR-01**: User database models (User, UserProtocol) with traffic quota and speed limit fields (Phase 4.1)
- [x] **V1-USR-02**: User list component displays all users with status, protocol, and actions (Phase 4.2)
- [x] **V1-USR-03**: User creation form for adding new users with name, email, and protocol settings (Phase 4.3)
- [x] **V1-USR-04**: User creation API persists user to database (Phase 4.4)
- [x] **V1-USR-05**: User edit form for modifying existing user settings (Phase 4.5)
- [x] **V1-USR-06**: User edit API updates user in database (Phase 4.6)
- [x] **V1-USR-07**: User delete API removes user from database (Phase 4.7)
- [x] **V1-USR-08**: Block/unblock APIs suspend or restore user access (Phase 4.8)
- [x] **V1-USR-09**: User sync system synchronizes users between AWG and 3x-ui (Phase 4.9)

### Configuration

- [x] **V1-CFG-01**: Configuration templates define common VPN parameter sets (Phase 5.1)
- [x] **V1-CFG-02**: Protocol templates for WireGuard, VLESS, Trojan, Shadowsocks (Phase 5.2)
- [x] **V1-CFG-03**: Auto-gen configuration API generates VPN configs from templates (Phase 5.3)
- [x] **V1-CFG-04**: Export configurations endpoint produces downloadable config files (Phase 5.4)
- [x] **V1-CFG-05**: Import configurations endpoint parses uploaded config files (Phase 5.5)
- [x] **V1-CFG-06**: Configuration presets provide one-click setup for common scenarios (Phase 5.6)
- [x] **V1-CFG-07**: Configuration manager UI for browsing, editing, and applying configs (Phase 5.7)

### Traffic & Routing Limits

- [x] **V1-LIM-01**: Traffic quotas system enforces per-user data limits (Phase 6.1)
- [x] **V1-LIM-02**: Speed limits system controls per-user bandwidth (Phase 6.2)
- [x] **V1-LIM-03**: Routing rules API provides CRUD for routing rules (Phase 6.3)
- [x] **V1-LIM-04**: Routing rules UI displays and manages rules visually (Phase 6.4)
- [x] **V1-LIM-05**: Rule enforcement applies routing decisions to traffic (Phase 6.5)

### Dashboard & Monitoring

- [x] **V1-DSH-01**: Dashboard metrics aggregate key system and VPN statistics (Phase 7.1)
- [x] **V1-DSH-02**: Traffic statistics API provides per-user and aggregate traffic data (Phase 7.2)
- [x] **V1-DSH-03**: Stats display UI renders charts and tables for traffic data (Phase 7.3)
- [x] **V1-DSH-04**: Resource monitoring API reports CPU, memory, and disk usage (Phase 7.4)
- [x] **V1-DSH-05**: Resource display UI shows system resource gauges (Phase 7.5)
- [x] **V1-DSH-06**: Real-time updates via WebSocket for dashboard data (Phase 7.6)

### Multi-Server

- [x] **V1-SRV-01**: Multi-server management registers and lists VPN servers (Phase 8.1)
- [x] **V1-SRV-02**: Server configuration for each registered server (Phase 8.2)
- [x] **V1-SRV-03**: Chain templates define common multi-hop topologies (Phase 8.3)
- [x] **V1-SRV-04**: Auto-configure routing applies chain templates to servers (Phase 8.4)

### Chain & Geo

- [x] **V1-CHN-01**: Visual chain builder with node placement and connection (Phase 9.1)
- [x] **V1-CHN-02**: Geo-routing rules route traffic by destination geography (Phase 9.2)
- [x] **V1-CHN-03**: Whitelist management for bypass and exception lists (Phase 9.3)
- [x] **V1-CHN-04**: Live chain visualization shows real-time chain status (Phase 9.4)

### Alerts & Polish

- [x] **V1-ALT-01**: Service alert system detects and records service failures (Phase 10.1)
- [x] **V1-ALT-02**: Quota alert system triggers when users approach traffic limits (Phase 10.2)
- [x] **V1-ALT-03**: Resource alert system warns on high CPU/memory/disk usage (Phase 10.3)
- [x] **V1-ALT-04**: UI polish and responsive design across all pages (Phase 10.4)

## v1.1 Requirements

Requirements for multi-panel chain routing milestone. Each maps to roadmap phases.

### Multi-Panel Foundation

- [ ] **MPAN-01**: Admin can register remote panels (Tailscale IP, panel URL, auth credentials) from central panel
- [ ] **MPAN-02**: Admin can test connectivity to registered remote panels
- [ ] **MPAN-03**: Central panel monitors real-time connection status (connected/offline/error) for each remote panel
- [ ] **MPAN-04**: Admin can edit and remove registered remote panels

### Chain Config Push

- [ ] **CPUSH-01**: Admin can push chain configuration from central panel to all remote panels in a chain
- [ ] **CPUSH-02**: Central panel generates per-panel chain config based on each panel's role in the chain
- [ ] **CPUSH-03**: Push results display per-panel success/failed status with error details
- [ ] **CPUSH-04**: Admin can preview config diff before pushing to remote panels
- [ ] **CPUSH-05**: Admin can rollback a pushed configuration to the previous known-good config on any remote panel
- [ ] **CPUSH-06**: Push errors include recommendations, known fixes, and best practices for resolution

### Chain Configuration Application

- [ ] **CHAIN-01**: Pushed chain config is actually applied to AWG and 3x-ui services on remote servers
- [ ] **CHAIN-02**: 3x-ui configuration is applied via its REST API
- [ ] **CHAIN-03**: AWG configuration is applied via CLI commands over Tailscale

### Visual Chain Editor

- [ ] **VISED-01**: Admin can build chain topology with drag-and-drop node placement
- [ ] **VISED-02**: Admin can edit routing rules inline within the chain editor
- [ ] **VISED-03**: Chain editor shows panel boundaries and which panel owns which nodes

### Geo-Routing

- [ ] **GEO-01**: Geo-routing rules are persisted to SQLite (replacing v1.0 in-memory stores)
- [ ] **GEO-02**: Admin can define geo-routing rules by country code, region, or custom criteria
- [ ] **GEO-03**: Traffic is routed to specific chain hops based on destination geo (via GeoIP lookup)
- [ ] **GEO-04**: System can auto-load routing rule files from v2fly/geoip and sendmiche/rulite repositories

### Routing Rules

- [ ] **RULE-01**: Admin can create, edit, delete, and reorder routing rules
- [ ] **RULE-02**: Routing rule templates are available with best-practice defaults
- [ ] **RULE-03**: Rules include priority, match conditions (IP/host/geo), and action (direct/chain/block)

### Tailscale Integration

- [ ] **TSCL-01**: Each server runs Tailscale as a subnet router advertising its VPN subnet
- [ ] **TSCL-02**: Central panel can list all Tailscale nodes in the tailnet
- [ ] **TSCL-03**: Tailscale subnet router setup is documented as step-by-step guide
- [ ] **TSCL-04**: Panel uses Tailscale IPs as transport addresses for inter-panel communication

### Hybrid Autonomy

- [ ] **HAUT-01**: Remote panels cache their last-known-good configuration locally
- [ ] **HAUT-02**: Remote panels continue operating on cached config when central panel is unreachable
- [ ] **HAUT-03**: Config sync resumes automatically when central connection is restored

### Pre-Configuration Templates

- [ ] **TMPL-01**: Admin can use VPN protocol templates (VLESS-REALITY, Hysteria2, TUIC, and existing protocols)
- [ ] **TMPL-02**: Admin can use server presets for common VPS providers and OS configurations
- [ ] **TMPL-03**: Admin can use routing presets (geo rule bundles: Russia Direct, EU Privacy, Full Tunnel)
- [ ] **TMPL-04**: Admin can use chain presets combining chain topology + protocols + routing rules

### Dashboard

- [ ] **DASH-01**: Central health dashboard aggregates service status, traffic, and alerts from all remote panels

## v1.0 milestone audit remediation (Phase 12.x)

Closes structured gaps from `.planning/v1.0-MILESTONE-AUDIT.md`. Not part of original v1.0/v1.1 requirement sets; added for traceability.

### Security & real-time

- [x] **PROJ-AUTH-01**: Admin-affecting `/api` routes enforce session/JWT; implementation matches documented session layer (see audit: `src/proxy.ts` vs middleware)
- [ ] **PROJ-RT-01**: Socket.IO server attaches to HTTP; clients use compatible protocol for chain status and dashboard real-time paths; `broadcastEvent` is effective

### Planning & evidence

- [x] **PROJ-TRACE-01**: Phases 1.1–10.4 have REQ-ID (or equivalent) mapping in `REQUIREMENTS.md`; audit-critical phases gain `VERIFICATION.md` / validation pilot per Phase 12.3 scope

### Integration follow-ups (audit warnings)

- [ ] **GAPL-01**: Remote config apply path aligns with central push (no reliance on missing `/api/sync/apply` or documented equivalent)
- [ ] **GAPL-02**: WebSocket events invalidate React Query (or equivalent) for dashboard/resource stats where polling is currently the only refresh path

## v1.1 milestone audit gap closure (Phases 12.5–12.7)

Closes structured integration gaps from `.planning/v1.1-MILESTONE-AUDIT.md`. Reuses existing v1.1 REQ-IDs; traceability rows below point gap-closure work at Phases 12.5–12.7 (after v1.0 audit Phases 12.1–12.4).

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Deployment & Hardening

- **DEPL-01**: Persist geo-routing/whitelist to DB with migration from in-memory stores
- **DEPL-02**: Real CLI install commands for AWG and 3x-ui (replace stubs)
- **DEPL-03**: Live config reading from actual AWG/Xray config files
- **DEPL-04**: Docker Compose deployment setup for the panel
- **DEPL-05**: Systemd service deployment setup for the panel

### Docker VPN Support

- **DOCK-01**: Auto-detect Docker-based AWG and 3x-ui installations
- **DOCK-02**: Full lifecycle management of Docker VPN containers (start/stop/restart)
- **DOCK-03**: Docker API integration for container monitoring

### Advanced Features

- **SYNC-01**: Bidirectional config sync between panels
- **SYNC-02**: Automatic failover between chain nodes
- **SYNC-03**: Config version history and full audit log
- **SYNC-04**: Remote panel auto-discovery via mDNS/DNS-SD

## Out of Scope

| Feature | Reason |
|---------|--------|
| Bidirectional config sync | Overkill for single admin, adds conflict resolution complexity |
| Automatic failover | Not needed at 1-3 server scale, manual failover sufficient |
| Tailscale as end-user VPN | Tailscale is infrastructure transport only, users connect via AWG/3x-ui |
| Config version history | Simple last-known-good snapshot for rollback, no full history |
| Remote panel auto-discovery | Security risk, manual registration with credentials is safer |
| Multi-admin RBAC | Single admin only, already excluded in v1.0 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TSCL-01 | Phase 12.7 | Pending |
| TSCL-02 | Phase 12.7 | Pending |
| TSCL-03 | Phase 12.7 | Pending |
| TSCL-04 | Phase 12.7 | Pending |
| MPAN-01 | Phase 11.2 | Pending |
| MPAN-02 | Phase 11.2 | Pending |
| MPAN-03 | Phase 11.2 | Pending |
| MPAN-04 | Phase 11.2 | Pending |
| CPUSH-01 | Phase 12.5 | Done (12.5-01) |
| CPUSH-02 | Phase 12.5 | Done (12.5-01) |
| CPUSH-03 | Phase 12.5 | Done (12.5-01) |
| HAUT-01 | Phase 11.3 | Pending |
| HAUT-02 | Phase 11.3 | Pending |
| HAUT-03 | Phase 11.3 | Pending |
| CPUSH-04 | Phase 12.5 | Done (12.5-01) |
| CPUSH-05 | Phase 12.5 | Done (12.5-01) |
| CPUSH-06 | Phase 12.5 | Done (12.5-01) |
| CHAIN-01 | Phase 12.5 | Done (12.5-01) |
| CHAIN-02 | Phase 11.4 | Pending |
| CHAIN-03 | Phase 11.4 | Pending |
| GEO-01 | Phase 11.5 | Pending |
| GEO-02 | Phase 11.5 | Pending |
| GEO-03 | Phase 12.6 | Pending |
| GEO-04 | Phase 12.6 | Pending |
| RULE-01 | Phase 11.5 | Done (11.5-01, 11.5-03) |
| RULE-02 | Phase 11.5 | Pending |
| RULE-03 | Phase 11.5 | Done (11.5-03) |
| VISED-01 | Phase 11.6 | Pending |
| VISED-02 | Phase 11.6 | Pending |
| VISED-03 | Phase 12.5 | Done (12.5-01) |
| TMPL-01 | Phase 11.7 | Pending |
| TMPL-02 | Phase 11.7 | Pending |
| TMPL-03 | Phase 11.7 | Pending |
| TMPL-04 | Phase 11.7 | Pending |
| DASH-01 | Phase 11.8 | Pending |
| PROJ-AUTH-01 | Phase 12.1 | Done |
| PROJ-RT-01 | Phase 12.2 | Pending |
| PROJ-TRACE-01 | Phase 12.3 | Done |
| GAPL-01 | Phase 12.4 | Pending |
| GAPL-02 | Phase 12.4 | Pending |
| V1-INIT-01 | Phase 1.1 | Done |
| V1-INIT-02 | Phase 1.2 | Done |
| V1-INIT-03 | Phase 1.3 | Done |
| V1-INIT-04 | Phase 1.4 | Done |
| V1-INIT-05 | Phase 1.5 | Done |
| V1-INIT-06 | Phase 1.6 | Done |
| V1-INIT-07 | Phase 1.7 | Done |
| V1-AUTH-01 | Phase 2.1 | Done |
| V1-AUTH-02 | Phase 2.2 | Done |
| V1-AUTH-03 | Phase 2.3 | Done |
| V1-AUTH-04 | Phase 2.4 | Done |
| V1-AUTH-05 | Phase 2.5 | Done |
| V1-SVC-01 | Phase 3.1 | Done |
| V1-SVC-02 | Phase 3.2 | Done |
| V1-SVC-03 | Phase 3.3 | Done |
| V1-SVC-04 | Phase 3.4 | Done |
| V1-SVC-05 | Phase 3.5 | Done |
| V1-SVC-06 | Phase 3.6 | Done |
| V1-SVC-07 | Phase 3.7 | Done |
| V1-USR-01 | Phase 4.1 | Done |
| V1-USR-02 | Phase 4.2 | Done |
| V1-USR-03 | Phase 4.3 | Done |
| V1-USR-04 | Phase 4.4 | Done |
| V1-USR-05 | Phase 4.5 | Done |
| V1-USR-06 | Phase 4.6 | Done |
| V1-USR-07 | Phase 4.7 | Done |
| V1-USR-08 | Phase 4.8 | Done |
| V1-USR-09 | Phase 4.9 | Done |
| V1-CFG-01 | Phase 5.1 | Done |
| V1-CFG-02 | Phase 5.2 | Done |
| V1-CFG-03 | Phase 5.3 | Done |
| V1-CFG-04 | Phase 5.4 | Done |
| V1-CFG-05 | Phase 5.5 | Done |
| V1-CFG-06 | Phase 5.6 | Done |
| V1-CFG-07 | Phase 5.7 | Done |
| V1-LIM-01 | Phase 6.1 | Done |
| V1-LIM-02 | Phase 6.2 | Done |
| V1-LIM-03 | Phase 6.3 | Done |
| V1-LIM-04 | Phase 6.4 | Done |
| V1-LIM-05 | Phase 6.5 | Done |
| V1-DSH-01 | Phase 7.1 | Done |
| V1-DSH-02 | Phase 7.2 | Done |
| V1-DSH-03 | Phase 7.3 | Done |
| V1-DSH-04 | Phase 7.4 | Done |
| V1-DSH-05 | Phase 7.5 | Done |
| V1-DSH-06 | Phase 7.6 | Done |
| V1-SRV-01 | Phase 8.1 | Done |
| V1-SRV-02 | Phase 8.2 | Done |
| V1-SRV-03 | Phase 8.3 | Done |
| V1-SRV-04 | Phase 8.4 | Done |
| V1-CHN-01 | Phase 9.1 | Done |
| V1-CHN-02 | Phase 9.2 | Done |
| V1-CHN-03 | Phase 9.3 | Done |
| V1-CHN-04 | Phase 9.4 | Done |
| V1-ALT-01 | Phase 10.1 | Done |
| V1-ALT-02 | Phase 10.2 | Done |
| V1-ALT-03 | Phase 10.3 | Done |
| V1-ALT-04 | Phase 10.4 | Done |

**Coverage:**
- v1.0 requirements: 54 total (7 INIT + 5 AUTH + 7 SVC + 9 USR + 7 CFG + 5 LIM + 6 DSH + 4 SRV + 4 CHN + 4 ALT)
- v1.1 requirements: 35 total
- Mapped to phases: 89 total (54 v1.0 + 35 v1.1)
- Unmapped: 0
- v1.0 audit remediation: 5 requirements (PROJ-*, GAPL-*) mapped to Phases 12.1–12.4
- v1.1 audit gap closure: 15 requirements (CPUSH-01–06, CHAIN-01, VISED-03, GEO-03, GEO-04, TSCL-01–04) mapped to Phases 12.5–12.7

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-05-01 — Phase 12.5: CPUSH-01-06, CHAIN-01, VISED-03 marked done*
