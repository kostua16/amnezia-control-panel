# Amnezia Control Panel

## What This Is

Unified admin control panel for managing Amnezia AWG2 (AmneziaVPN WireGuard) and 3x-ui on the same VPN server. Single administrator manages users across both systems, configures VPN services, controls routing, monitors traffic and health — all from one interface instead of switching between separate panels.

## Core Value

One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching between separate management interfaces.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Unified user management across Amnezia AWG and 3x-ui (create, delete, block, sync)
- [ ] Server configuration (WireGuard interfaces, ports, DNS)
- [ ] Route management (user-to-server/protocol traffic routing)
- [ ] Traffic limits, quotas, and speed limits per user
- [ ] Installation and deinstallation of Amnezia and 3x-ui services
- [ ] Multiple endpoints (servers) support
- [ ] Service health monitoring (online/offline status of VPN services)
- [ ] Traffic statistics per user per time period
- [ ] Server resource monitoring (CPU, RAM, disk)
- [ ] Alerts for service failures and limit exceedances
- [ ] Single admin authentication (login/password)

### Out of Scope

- Multi-admin roles — single administrator only, no RBAC needed at this scale
- End-user self-service portal — admin-only panel, users don't log in
- Billing/payment integration — not a commercial VPN, no payment processing
- Mobile app — web-first, responsive design sufficient
- Multi-tenant isolation — single server deployment

## Context

- Administrator currently manages Amnezia VPN and 3x-ui through separate panels, switching between them
- Both systems share the same users — changes must be synchronized
- Scale: 1-3 VPN servers, up to 50 users
- Amnezia AWG2 uses WireGuard protocol with AmneziaWG obfuscation extensions
- 3x-ui is a popular Xray panel supporting VLESS, VMess, Trojan, Shadowsocks protocols
- Both 3x-ui and Amnezia have management APIs that need investigation
- Panel will be deployed on the same server as the VPN services

## Constraints

- **Deployment**: Same server as VPN services — no separate management host
- **Scale**: Small — 1-3 servers, up to 50 users, single admin
- **Compatibility**: Must work alongside existing Amnezia and 3x-ui installations
- **OS**: Linux server environment (typical VPS/dedicated)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Deploy on same server as VPN | Simplifies management, no remote API needed for local services | — Pending |
| Single admin, no roles | Small scale, single operator | — Pending |
| Stack: TBD | Research needed to determine best fit | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-27 after initialization*
