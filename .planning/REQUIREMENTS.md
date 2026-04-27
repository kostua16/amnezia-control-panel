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
| AUTH-01 | Phase 2.2 - Login API Endpoint | Pending |
| AUTH-02 | Phase 2.3 - Session Management | Pending |
| AUTH-03 | Phase 2.5 - Logout Functionality | Pending |
| USER-01 | Phase 4.3 - User Creation Form, Phase 4.4 - User Creation API | Pending |
| USER-02 | Phase 4.5 - User Edit Form, Phase 4.6 - User Edit API | Pending |
| USER-03 | Phase 4.7 - User Delete API | Pending |
| USER-04 | Phase 4.8 - Block/Unblock APIs | Pending |
| USER-05 | Phase 4.9 - User Sync System | Pending |
| USER-06 | Phase 4.2 - User List Component | Pending |
| SERV-01 | Phase 3.1 - Service Status API | Pending |
| SERV-02 | Phase 3.1 - Service Status API | Pending |
| SERV-03 | Phase 3.3 - Service Install API - AWG | Pending |
| SERV-04 | Phase 3.4 - Service Install API - 3x-ui | Pending |
| SERV-05 | Phase 3.5 - Service Uninstall APIs | Pending |
| SERV-06 | Phase 3.5 - Service Uninstall APIs | Pending |
| SERV-07 | Phase 3.6 - Auto-restart Logic | Pending |
| SERV-08 | Phase 3.7 - Configuration Display | Pending |
| CONF-01 | Phase 5.1 - Configuration Templates, Phase 5.3 - Auto-gen Configuration API | Pending |
| CONF-02 | Phase 5.1 - Configuration Templates, Phase 5.3 - Auto-gen Configuration API | Pending |
| CONF-03 | Phase 5.2 - Protocol Templates | Pending |
| CONF-04 | Phase 5.2 - Protocol Templates | Pending |
| CONF-05 | Phase 5.4 - Export Configurations | Pending |
| CONF-06 | Phase 5.5 - Import Configurations | Pending |
| CONF-07 | Phase 5.6 - Configuration Presets | Pending |
| ROUTE-01 | Phase 6.1 - Traffic Quotas System | Pending |
| ROUTE-02 | Phase 6.2 - Speed Limits System | Pending |
| ROUTE-03 | Phase 6.3 - Routing Rules API | Pending |
| ROUTE-04 | Phase 6.4 - Routing Rules UI, Phase 6.5 - Rule Enforcement | Pending |
| MON-01 | Phase 7.1 - Dashboard Metrics | Pending |
| MON-02 | Phase 7.2 - Traffic Statistics API, Phase 7.3 - Stats Display UI | Pending |
| MON-03 | Phase 7.4 - Resource Monitoring API, Phase 7.5 - Resource Display UI | Pending |
| MON-04 | Phase 7.6 - Real-time Updates | Pending |
| CHAIN-01 | Phase 8.1 - Multi-server Management | Pending |
| CHAIN-03 | Phase 8.4 - Auto-configure Routing | Pending |
| CHAIN-06 | Phase 8.3 - Chain Templates System | Pending |
| CHAIN-02 | Phase 9.1 - Visual Chain Builder | Pending |
| CHAIN-04 | Phase 9.2 - Geo-Routing Rules | Pending |
| CHAIN-05 | Phase 9.3 - Whitelist Management | Pending |
| CHAIN-07 | Phase 9.4 - Live Chain Visualization | Pending |
| ALERT-01 | Phase 10.1 - Service Alert System | Pending |
| ALERT-02 | Phase 10.2 - Quota Alert System | Pending |
| ALERT-03 | Phase 10.3 - Resource Alert System | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 42
- Unmapped: 0 ✓

---

*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 - Updated traceability for refined phase structure*