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

**Coverage:**
- v1.1 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27 ⚠️

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 after initial definition*
