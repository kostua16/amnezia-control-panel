# Requirements: Amnezia Control Panel

**Defined:** 2026-04-27
**Core Value:** One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: Admin can login with username and password
- [ ] **AUTH-02**: Admin session persists across browser refreshes
- [ ] **AUTH-03**: Admin can logout from any page

### User Management

- [ ] **USER-01**: Admin can create user that propagates to both Amnezia AWG and 3x-ui
- [ ] **USER-02**: Admin can edit user settings (name, limits, assigned protocols)
- [ ] **USER-03**: Admin can delete user from both systems
- [ ] **USER-04**: Admin can block and unblock user
- [ ] **USER-05**: User state synchronized automatically between Amnezia AWG and 3x-ui
- [ ] **USER-06**: Admin can view list of all users with their status and assigned services

### Service Management

- [ ] **SERV-01**: Admin can view real-time status of Amnezia AWG service (online/offline)
- [ ] **SERV-02**: Admin can view real-time status of 3x-ui service (online/offline)
- [ ] **SERV-03**: Admin can install Amnezia AWG on the server from the panel
- [ ] **SERV-04**: Admin can install 3x-ui on the server from the panel
- [ ] **SERV-05**: Admin can uninstall Amnezia AWG from the panel
- [ ] **SERV-06**: Admin can uninstall 3x-ui from the panel
- [ ] **SERV-07**: Failed VPN services auto-restart with notification to admin
- [ ] **SERV-08**: Admin can view current VPN configuration (ports, interfaces, DNS, protocols)

### Configuration

- [ ] **CONF-01**: Auto-generation of configuration files with recommended settings for Amnezia AWG
- [ ] **CONF-02**: Auto-generation of configuration files with recommended settings for 3x-ui
- [ ] **CONF-03**: Protocol templates for Amnezia AWG (WireGuard, AmneziaWG with obfuscation presets)
- [ ] **CONF-04**: Protocol templates for 3x-ui (VLESS, VMess, Trojan, Shadowsocks with presets)
- [ ] **CONF-05**: Admin can export all configurations to file for backup
- [ ] **CONF-06**: Admin can import configurations from file for restore
- [ ] **CONF-07**: Recommended settings presets for common deployment scenarios

### Routing & Limits

- [ ] **ROUTE-01**: Admin can set traffic quotas per user
- [ ] **ROUTE-02**: Admin can set speed limits per user
- [ ] **ROUTE-03**: Admin can create routing rules by user, protocol, or time schedule
- [ ] **ROUTE-04**: Admin can view, edit, and reorder active routing rules

### VPN Chaining

- [ ] **CHAIN-01**: Admin can add multiple VPN servers to the panel and manage them
- [ ] **CHAIN-02**: Visual drag-and-drop builder for creating VPN server chain topologies
- [ ] **CHAIN-03**: Auto-configuration of WireGuard/Xray routing rules for chain links
- [ ] **CHAIN-04**: Geo-routing rules that route traffic based on destination geography
- [ ] **CHAIN-05**: Whitelist management for local and regional services per chain node
- [ ] **CHAIN-06**: Pre-built chain templates for common topologies (2-hop, 3-hop, split-routing)
- [ ] **CHAIN-07**: Live visualization of chain topology with active traffic flow indicators

### Monitoring

- [ ] **MON-01**: Dashboard with key metrics (users online, total traffic, service status overview)
- [ ] **MON-02**: Traffic statistics per user per time period (hour, day, week, month)
- [ ] **MON-03**: Server resource monitoring display (CPU, RAM, disk usage)
- [ ] **MON-04**: Real-time traffic monitoring via WebSocket connection

### Alerts

- [ ] **ALERT-01**: Alert notification when VPN service goes down
- [ ] **ALERT-02**: Alert notification when user exceeds traffic quota
- [ ] **ALERT-03**: Alert notification when server resources exceed defined threshold

## v2 Requirements

### Enhanced Monitoring

- **EMON-01**: Historical traffic analytics with charts and trends
- **EMON-02**: Connection log with per-user connection history
- **EMON-03**: Bandwidth forecasting based on usage patterns

### Advanced Chain Features

- **ACHAIN-01**: Dynamic chain re-routing based on server load
- **ACHAIN-02**: Chain health monitoring with latency metrics
- **ACHAIN-03**: Automatic chain failover when intermediate node fails

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-admin roles / RBAC | Single administrator, no need for role management |
| End-user self-service portal | Admin-only tool, end users don't access the panel |
| Billing / payment integration | Not a commercial VPN service |
| Mobile native app | Web-first with responsive design covers mobile needs |
| Plugin system | Adds unnecessary complexity for single-admin tool |
| Multi-tenant isolation | Single server deployment, no tenant separation needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | — | Pending |
| AUTH-02 | — | Pending |
| AUTH-03 | — | Pending |
| USER-01 | — | Pending |
| USER-02 | — | Pending |
| USER-03 | — | Pending |
| USER-04 | — | Pending |
| USER-05 | — | Pending |
| USER-06 | — | Pending |
| SERV-01 | — | Pending |
| SERV-02 | — | Pending |
| SERV-03 | — | Pending |
| SERV-04 | — | Pending |
| SERV-05 | — | Pending |
| SERV-06 | — | Pending |
| SERV-07 | — | Pending |
| SERV-08 | — | Pending |
| CONF-01 | — | Pending |
| CONF-02 | — | Pending |
| CONF-03 | — | Pending |
| CONF-04 | — | Pending |
| CONF-05 | — | Pending |
| CONF-06 | — | Pending |
| CONF-07 | — | Pending |
| ROUTE-01 | — | Pending |
| ROUTE-02 | — | Pending |
| ROUTE-03 | — | Pending |
| ROUTE-04 | — | Pending |
| CHAIN-01 | — | Pending |
| CHAIN-02 | — | Pending |
| CHAIN-03 | — | Pending |
| CHAIN-04 | — | Pending |
| CHAIN-05 | — | Pending |
| CHAIN-06 | — | Pending |
| CHAIN-07 | — | Pending |
| MON-01 | — | Pending |
| MON-02 | — | Pending |
| MON-03 | — | Pending |
| MON-04 | — | Pending |
| ALERT-01 | — | Pending |
| ALERT-02 | — | Pending |
| ALERT-03 | — | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 0
- Unmapped: 42 ⚠️

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 after initial definition*
