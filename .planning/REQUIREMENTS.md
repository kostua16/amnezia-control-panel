# Requirements: Amnezia Control Panel

**Defined:** 2026-04-29
**Core Value:** One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching

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

- [ ] **PROJ-AUTH-01**: Admin-affecting `/api` routes enforce session/JWT; implementation matches documented session layer (see audit: `src/proxy.ts` vs middleware)
- [ ] **PROJ-RT-01**: Socket.IO server attaches to HTTP; clients use compatible protocol for chain status and dashboard real-time paths; `broadcastEvent` is effective

### Planning & evidence

- [ ] **PROJ-TRACE-01**: Phases 1.1–10.4 have REQ-ID (or equivalent) mapping in `REQUIREMENTS.md`; audit-critical phases gain `VERIFICATION.md` / validation pilot per Phase 12.3 scope

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
| CPUSH-01 | Phase 12.5 | Pending |
| CPUSH-02 | Phase 12.5 | Pending |
| CPUSH-03 | Phase 12.5 | Pending |
| HAUT-01 | Phase 11.3 | Pending |
| HAUT-02 | Phase 11.3 | Pending |
| HAUT-03 | Phase 11.3 | Pending |
| CPUSH-04 | Phase 12.5 | Pending |
| CPUSH-05 | Phase 12.5 | Pending |
| CPUSH-06 | Phase 12.5 | Pending |
| CHAIN-01 | Phase 12.5 | Pending |
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
| VISED-03 | Phase 12.5 | Pending |
| TMPL-01 | Phase 11.7 | Pending |
| TMPL-02 | Phase 11.7 | Pending |
| TMPL-03 | Phase 11.7 | Pending |
| TMPL-04 | Phase 11.7 | Pending |
| DASH-01 | Phase 11.8 | Pending |
| PROJ-AUTH-01 | Phase 12.1 | Pending |
| PROJ-RT-01 | Phase 12.2 | Pending |
| PROJ-TRACE-01 | Phase 12.3 | Pending |
| GAPL-01 | Phase 12.4 | Pending |
| GAPL-02 | Phase 12.4 | Pending |

**Coverage:**
- v1.1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0
- v1.0 audit remediation: 5 requirements (PROJ-*, GAPL-*) mapped to Phases 12.1–12.4
- v1.1 audit gap closure: 15 requirements (CPUSH-01–06, CHAIN-01, VISED-03, GEO-03, GEO-04, TSCL-01–04) mapped to Phases 12.5–12.7

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-05-01 — Phases 12.5–12.7 traceability (v1.1 milestone audit gap closure)*
