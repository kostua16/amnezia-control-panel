# Amnezia Control Panel

## What This Is

Unified admin control panel for managing Amnezia AWG2 (AmneziaVPN WireGuard) and 3x-ui on the same VPN server. Single administrator manages users across both systems, configures VPN services, controls routing, monitors traffic and health — all from one interface instead of switching between separate panels.

## Core Value

One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching between separate management interfaces.

## Requirements

### Validated

- ✓ Admin authentication (login/password, JWT sessions, logout) — v1.0
- ✓ Unified user management across AWG and 3x-ui (create, edit, delete, block, sync) — v1.0
- ✓ Service health monitoring (online/offline status, auto-restart) — v1.0
- ✓ Installation/deinstallation of VPN services (placeholder — needs real CLI on server) — v1.0
- ✓ VPN configuration management (templates, protocols, auto-gen, export/import, presets) — v1.0
- ✓ Traffic limits, quotas, and speed limits per user — v1.0
- ✓ Routing rules (create, edit, reorder, enforce) — v1.0
- ✓ Multi-server management and VPN chaining — v1.0
- ✓ Visual chain builder with geo-routing and whitelists — v1.0
- ✓ Dashboard metrics, traffic statistics, resource monitoring — v1.0
- ✓ Real-time WebSocket updates — v1.0
- ✓ Alert system (service failures, quota thresholds, resource thresholds) — v1.0

### Active

(None — all v1 requirements shipped)

### Out of Scope

- Multi-admin roles — single administrator only, no RBAC needed at this scale
- End-user self-service portal — admin-only panel, users don't log in
- Billing/payment integration — not a commercial VPN, no payment processing
- Mobile app — web-first, responsive design sufficient
- Multi-tenant isolation — single server deployment

## Context

- **Stack**: Next.js 15 + React 19 + TypeScript + Prisma + SQLite + Socket.io + Tailwind CSS
- **Scale**: 1-3 VPN servers, up to 50 users, single admin
- **Deployment**: Same server as VPN services (Linux)
- **Database**: SQLite via Prisma with better-sqlite3 adapter
- **Auth**: JWT (jose) with httpOnly cookies, bcryptjs password hashing
- **State**: Zustand (client) + React Query (server state)
- **Real-time**: Socket.io WebSocket for dashboard updates
- **VPN integration**: Stubbed CLI commands in `src/lib/vpn-services.ts` — need real `amneziawg` and `xui` tools on deployment server

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Deploy on same server as VPN | Simplifies management, no remote API needed | ✓ Working |
| Single admin, no roles | Small scale, single operator | ✓ Working |
| Stack: Next.js 15 + React 19 + TypeScript | Full-stack framework with SSR and API routes | ✓ Working |
| SQLite over PostgreSQL | Small scale, single-server, zero config | ✓ Working |
| JWT in httpOnly cookies | Secure session persistence, no localStorage XSS risk | ✓ Working |
| In-memory stores for geo-routing/whitelist | Simplified MVP — needs DB persistence in v1.1 | — Tech debt |

## Constraints

- **Deployment**: Same server as VPN services — no separate management host
- **Scale**: Small — 1-3 servers, up to 50 users, single admin
- **Compatibility**: Must work alongside existing Amnezia and 3x-ui installations
- **OS**: Linux server environment (typical VPS/dedicated)

---

*Last updated: 2026-04-29 after v1.0 milestone*
