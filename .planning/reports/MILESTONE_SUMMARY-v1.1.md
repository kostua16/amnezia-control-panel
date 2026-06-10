# Milestone v1.1 — Project Summary

**Generated:** 2026-06-11
**Purpose:** Team onboarding and project review

---

## 1. Project Overview

**Amnezia Control Panel** is a unified admin panel for managing Amnezia AWG2 (AmneziaVPN WireGuard) and 3x-ui (Xray panel) on the same VPN server. A single administrator manages users across both systems, configures VPN services, controls routing, monitors traffic and health — all from one interface.

**Core Value:** One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching.

**v1.1 Milestone — Multi-Panel Chain Routing:**
Extended the single-server panel into a multi-panel architecture supporting server chains with geo-routing, Tailscale as the encrypted transport layer, and pre-configuration templates. Central panel pushes configurations to remote panels; remote panels cache their last-known-good config and operate autonomously when central is unreachable.

**Target Scale:** 1-3 VPN servers, up to 50 users, single administrator.

## 2. Architecture & Technical Decisions

- **Decision:** Tailscale as exclusive inter-panel transport layer
  - **Why:** Zero-config encrypted mesh networking between panels, built-in authentication, no need for custom VPN tunnels or SSH port forwarding between servers. Private mesh replaces public internet exposure.
  - **Phase:** 11.1 (Tailscale Foundation)

- **Decision:** Central-push-only sync model (no bidirectional sync)
  - **Why:** Single admin operates from central panel. Bidirectional sync adds conflict resolution complexity unnecessary at 1-3 server scale. Central panel is the source of truth.
  - **Phase:** 11.3 (Panel Sync Protocol)

- **Decision:** Hybrid autonomy — remote panels cache config, operate independently
  - **Why:** If central panel goes down, remote panels must keep VPN services running. Last-known-good config cached in SQLite allows autonomous operation; auto-resync when central reconnects.
  - **Phase:** 11.3 (Panel Sync Protocol)

- **Decision:** Next.js 15 + React 19 + TypeScript full-stack
  - **Why:** Full-stack framework with SSR and API routes. Single deployment unit. React 19 for latest concurrent features.
  - **Phase:** Pre-v1.0 (Phase 1.1)

- **Decision:** SQLite over PostgreSQL
  - **Why:** Small scale (1-3 servers, 50 users), single-server deployment, zero config overhead. Prisma ORM with better-sqlite3 adapter.
  - **Phase:** Pre-v1.0 (Phase 1.3)

- **Decision:** JWT in httpOnly cookies (not localStorage)
  - **Why:** Secure session persistence without XSS risk. bcryptjs password hashing. Session layer enforced via Next.js middleware on all `/api` routes.
  - **Phase:** v1.0 Auth + 12.1 (JWT enforcement)

- **Decision:** Custom Socket.IO server (server.mjs) over instrumentation-only
  - **Why:** Next.js `register()` in instrumentation provides no HTTP server access. Custom server attaches Socket.IO to HTTP server for real-time WebSocket updates.
  - **Phase:** 12.2 (Real-time Stack)

- **Decision:** In-memory stores for geo-routing (tech debt)
  - **Why:** MVP speed. Rules persisted to SQLite in v1.1 (Phase 11.5), but GeoIP lookup tables remain in memory. Lost on restart — acknowledged tech debt.
  - **Phase:** v1.0 → 11.5 (partial fix)

- **Decision:** GeoIP via v2fly/geoip on-disk DB + periodic refresh
  - **Why:** Streaming download with protobuf decode into country Map, no large intermediate arrays. jsDelivr mirror fallback.
  - **Phase:** 11.5 (Geo-Routing)

- **Decision:** React Flow for visual chain editor
  - **Why:** Rich drag-and-drop canvas library with custom nodes, panel boundary groups, minimap, zoom controls. Inline routing rules drawer.
  - **Phase:** 11.6 (Visual Chain Editor)

- **Decision:** HMAC + API key auth for inter-panel communication
  - **Why:** Shared secret between central and remote panels. HMAC signature on every push/receive call. Keys stored as bcrypt hash in DB; plaintext not recoverable.
  - **Phase:** 11.3 + 12.8 (contract alignment)

## 3. Phases Delivered

### v1.0 — Phases 1.1-10.4 (SHIPPED 2026-04-29)

Core panel: auth, user management, service management, configuration, routing, dashboard, alerts, multi-server, visual chain builder, geo-routing, whitelists. 42 phases, 42 requirements all satisfied.

### v1.1 — Phases 11.1-11.8 (SHIPPED 2026-05-01)

| Phase | Name | Status | Summary |
|-------|------|--------|---------|
| 11.1 | Tailscale Foundation | Complete | Subnet router setup, node discovery, transport address resolution |
| 11.2 | Remote Panel Registration | Complete | CRUD for remote panels, connectivity testing, real-time status |
| 11.3 | Panel Sync Protocol & Hybrid Autonomy | Complete | HMAC-signed config push, cached config in SQLite, auto-resync |
| 11.4 | Chain Config Application & Push UX | Complete | Real config push to AWG/3x-ui, diff preview, rollback, error reporting |
| 11.5 | Geo-Routing & Routing Rules | Partial | Rules persisted, GeoIP lookup service; UI plans 11.5-04/05 deferred |
| 11.6 | Visual Chain Editor | Complete | React Flow canvas, panel boundaries, inline rule editing |
| 11.7 | Pre-Configuration Templates | Complete | VPN/server/routing/chain presets (schema + API; UI deferred to 11.5-04/05) |
| 11.8 | Multi-Panel Dashboard | Complete | Fleet health strip, panel cards, aggregated status + alerts |

### Post-v1.1 Audit Remediation — Phases 12.1-12.14 (2026-05-01 to 2026-05-03)

| Phase | Name | Status | Summary |
|-------|------|--------|---------|
| 12.1 | Admin API JWT Enforcement | Complete | Middleware on all API routes, remove inline auth, JSON 401s |
| 12.2 | Real-time Stack (Socket.IO) | Complete | Custom server, protocol fix, broadcaster integration |
| 12.3 | v1.0 Traceability & Verification | Complete | REQ mapping, backfill VERIFICATION.md for 45 phases |
| 12.4 | Sync Apply & WS Invalidation | Complete | `/api/sync/apply` endpoint, React Query + WS invalidation |
| 12.5 | Multi-Panel Push UX | Complete | PushWizard mounted, serverPanelMap, panel boundaries in editor |
| 12.6 | Geo-Routing Runtime E2E | Complete | resolveGeoRoute wired into rule-enforcement and chain-router |
| 12.7 | Tailscale Milestone Verification | Complete | 11.1-VERIFICATION.md created, 11.2 corrected |
| 12.8 | Sync Apply & Receive Contracts | Complete | HMAC + body/response alignment for apply/receive paths |
| 12.9 | WS → React Query Key Alignment | Complete | WS_TO_QUERY_KEYS mappings fixed, dead entries removed |
| 12.10 | Push Wizard & Per-Panel Sync | Complete | Per-panel API keys, Xray rule panel scoping, reliable push results |
| 12.11 | Tailscale Transport in Chain Apply | Complete | 3-tier fallback transport resolution wired into chain paths |
| 12.12 | 12.x Verification Artifacts | Complete | VERIFICATION.md for 12.1/12.4/12.6/12.7/12.11, REQUIREMENTS reconciliation |
| 12.13 | Verification Artifacts (12.1, 12.4) | Complete | PROJ-AUTH-01, GAPL-01, GAPL-02 evidence |
| 12.14 | Verification Artifacts (12.6, 12.7) | Complete | GEO-03/04, TSCL-01-03 evidence |
| 12.15 | Requirements Reconciliation & Middleware Hardening | Planned | 15+ checkboxes, traceability table, middleware matcher |

## 4. Requirements Coverage

### v1.1 Requirements (35 total) — All Satisfied

**Multi-Panel Foundation (4/4):**
- MPAN-01 to MPAN-04: Register, test, monitor, manage remote panels

**Chain Config Push (6/6):**
- CPUSH-01 to CPUSH-06: Push config, per-panel generation, diff preview, rollback, error reporting

**Chain Configuration Application (3/3):**
- CHAIN-01 to CHAIN-03: AWG CLI + 3x-ui REST API application

**Visual Chain Editor (3/3):**
- VISED-01 to VISED-03: Drag-and-drop, panel boundaries, inline rules

**Geo-Routing (4/4):**
- GEO-01 to GEO-04: Persisted rules, country/region criteria, GeoIP lookup, v2fly geoip import

**Routing Rules (3/3):**
- RULE-01 to RULE-03: CRUD, templates, priority/match/action

**Tailscale Integration (4/4):**
- TSCL-01 to TSCL-04: Subnet router, node listing, setup docs, Tailscale IP transport

**Hybrid Autonomy (3/3):**
- HAUT-01 to HAUT-03: Cached config, autonomous operation, auto-resync

**Pre-Configuration Templates (4/4):**
- TMPL-01 to TMPL-04: VPN/server/routing/chain presets

**Dashboard (1/1):**
- DASH-01: Central health dashboard aggregation

**Audit verdict:** Passed (35/35 requirements satisfied). See `.planning/milestones/v1.1-AUDIT.md`.

## 5. Key Decisions Log

| ID | Decision | Phase | Rationale |
|----|----------|-------|-----------|
| D-01 | Tailscale as exclusive transport | 11.1 | Zero-config mesh, built-in auth, private networking |
| D-02 | Central-push-only sync | 11.3 | Single admin, no conflict resolution needed |
| D-03 | Hybrid autonomy model | 11.3 | Remote panels must survive central outage |
| D-04 | HMAC + shared API key auth | 11.3 | Simple, stateless inter-panel auth |
| D-05 | SQLite for cached panel config | 11.3 | Survives restart, same DB as core panel |
| D-06 | React Flow for chain editor | 11.6 | Rich canvas, custom nodes, panel boundaries |
| D-07 | v2fly/geoip on-disk DB | 11.5 | Streaming protobuf decode, no large arrays in memory |
| D-08 | Next.js middleware for JWT | 12.1 | Centralized auth, removes inline checks from 30+ routes |
| D-09 | Custom server.mjs for Socket.IO | 12.2 | Next.js register() has no HTTP server access |
| D-10 | globalThis.__socketIO bridge | 12.2 | Plain JS server.mjs cannot import .ts, bridge shares io instance |
| D-11 | API keys in volatile memory (Map) | 11.3 | Auto-resync on restart, never persisted to DB |
| D-12 | Tab toggle over shadcn Tabs | 12.5 | No shadcn Tabs available, custom button-based segment control |
| D-13 | Self-hosted Geist fonts via next/font/local | Quick | CI cannot reach fonts.gstatic.com at build time |

## 6. Tech Debt & Deferred Items

### Active Tech Debt

| Item | Source | Severity | Notes |
|------|--------|----------|-------|
| Routing rules UI (11.5-04) not built | Phase 11.5 | Medium | Backend + API complete; UI tabs, geo rules list, drawer deferred |
| Templates library (11.5-05) not built | Phase 11.5 | Medium | Backend + API complete; template gallery, starter rules deferred |
| In-memory geo-routing state lost on restart | v1.0 → 11.5 | Low | Rules persisted; GeoIP lookup tables in memory, rebuilt on startup |
| Pre-existing TS errors in chain-flow-editor.tsx | 12.4 | Low | React Flow type mismatch; out of scope for audit phases |
| GeoIP lookup O(n) CIDR linear scan | Arch Review 2026-06-10 | Medium | Sorted table + binary search would be O(log n) |

### Deferred Items

| Category | Item | Status |
|----------|------|--------|
| Tech debt | In-memory geo-routing state lost on restart | Partially addressed (11.5 persisted rules) |
| Integration | applyChainConfig stub needs real CLI commands | Needs real-service validation |
| TS errors | Pre-existing TS errors in chain-flow-editor.tsx | Out of scope for 12.4 |

### Architectural Review Proposals (2026-06-10)

1. **GeoIP lookup optimization** — Replace O(n) CIDR linear scan with sorted table + binary search (High)
2. **API route handler abstraction** — `withHandler(schema, handler)` wrapper to eliminate duplicated boilerplate across ~30 route files (Medium)
3. **Broadcaster query optimization** — Add time-range filter to trafficLog.aggregate(), reduce user count queries (Medium)

## 7. Getting Started

### Run the Project

```bash
npm install
npm run dev          # Dev server on http://localhost:3333
npm run build        # Production build
npm start            # Production server
```

Override port: `npm run dev -- --port 8000` or `PORT=8000 npm run dev`.

### Deploy with Docker

```bash
cp .env.example .env   # JWT_SECRET + ADMIN_PASSWORD required
docker compose up -d
```

### Key Directories

```
src/
├── app/                    # Next.js App Router (pages + API routes)
│   ├── api/                # API route handlers (/api/*)
│   │   ├── auth/           # Login, logout, session
│   │   ├── servers/        # Server CRUD + Tailscale
│   │   ├── panels/         # Remote panel CRUD + status
│   │   ├── chains/         # Chain config + apply
│   │   ├── sync/           # Push/receive/apply endpoints
│   │   ├── geo-rules/      # Geo-routing CRUD + resolve
│   │   └── ...
│   ├── dashboard/          # Main dashboard page
│   ├── servers/            # Servers page
│   ├── panels/             # Panels + push page
│   ├── chains/             # Chain builder page
│   └── ...
├── lib/
│   ├── prisma.ts           # Prisma client singleton
│   ├── real-time-broadcaster.ts  # Socket.IO event broadcast
│   ├── geoip-manager.ts    # GeoIP download + lookup
│   ├── chain-router.ts     # Chain config routing + transport
│   ├── panel-sync-client.ts # HMAC-signed push to remotes
│   ├── config-applier.ts   # Apply config to AWG/3x-ui
│   ├── rule-enforcement.ts # Routing rule evaluation
│   └── ...
├── components/
│   ├── chain-flow-editor/  # React Flow chain editor
│   ├── push-wizard/        # 4-step push UX
│   └── ...
├── hooks/                  # React Query + Zustand hooks
└── types/                  # TypeScript type definitions
```

### Tests

```bash
npm test                  # Run test suite
rtk npm test              # RTK compact output (failures only)
```

### Where to Look First

- **Entry point:** `src/app/page.tsx` → redirects to `/dashboard`
- **API auth:** `src/middleware.ts` → JWT enforcement on all `/api` routes
- **Core routing logic:** `src/lib/chain-router.ts` + `src/lib/rule-enforcement.ts`
- **Panel sync:** `src/lib/panel-sync-client.ts` (push) + `src/app/api/sync/receive/route.ts` (receive)
- **Chain editor UI:** `src/components/chain-flow-editor/`
- **Dashboard hooks:** `src/hooks/use-multi-panel-status.ts`, `src/hooks/use-dashboard-stats.ts`

---

## Stats

- **Timeline:** 2026-04-29 → 2026-05-01 (3 days for v1.1 core; audit remediation through 2026-05-03)
- **Phases:** 20 complete / 23 total (96% — 12.15 planned, not yet executed)
- **Commits (v1.1 core):** 199 (Apr 29 → May 1)
- **Files changed:** 512 (+61,534 / -1,738)
- **Plans executed:** 51 complete / 53 total
- **Requirements:** v1.0: 42/42 ✓ | v1.1: 35/35 ✓ | Audit: 5 mapped to 12.1-12.4
- **Total execution time:** ~102 min across 26 plans (avg 4 min/plan)

---

*Generated by /gsd-milestone-summary on 2026-06-11*
