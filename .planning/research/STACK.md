# Technology Stack (v1.1 Additions)

**Project:** Amnezia Control Panel
**Milestone:** v1.1 Multi-Panel Chain Routing
**Researched:** 2026-04-29

## Scope

This file covers **new stack additions only** for v1.1 features: multi-panel chain routing, Tailscale subnet router transport, and pre-configuration templates. The existing validated stack (Next.js 16.2, React 19, Prisma 7.8, SQLite, Socket.io, Zustand, Tailwind CSS 4, jose JWT, zod) remains unchanged and is NOT repeated here.

---

## New Stack Additions

### Tailscale API Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native `fetch` (Node.js built-in) | Node 20+ | HTTP client for Tailscale REST API v2 | No official Node.js SDK exists. `@tailscale/connect` is abandoned (last published 2023, 0 dependents, 32.7MB WASM blob). Native `fetch` is zero-dependency, type-safe with TypeScript, and sufficient for ~6 API endpoints we need. |
| Custom `src/lib/tailscale-client.ts` | -- | Tailscale API wrapper module | Thin wrapper around `fetch` with OAuth token management, retry logic, and typed request/response interfaces. Approximately 150-200 lines. |

**Tailscale API authentication strategy: OAuth Client Credentials**

| Mechanism | API Key | OAuth Client Credentials | Workload Identity |
|-----------|---------|------------------------|-------------------|
| Longevity | Long-lived, up to 90 days | Client secret is permanent; access tokens expire in 1 hour | No static secrets |
| Scoping | Broad (all or nothing) | Fine-grained scopes per client | Fine-grained |
| Best for | Quick scripts | Production automation | Enterprise CI/CD |
| Security risk if leaked | High | Medium (scoped, short-lived tokens) | Lowest |

**Decision: OAuth Client Credentials.** We need `devices:core` (list/manage devices, set tags) and `dns:read`/`dns:write` (manage MagicDNS for panel discovery). OAuth gives scoped access and auto-rotating tokens. API keys are too broad and expire. Workload Identity is overkill for 1-3 servers.

**Required Tailscale API scopes:**

| Scope | Endpoints needed | Purpose |
|-------|-----------------|---------|
| `devices:core` | `GET /api/v2/tailnet/{tailnet}/devices`, `POST /api/v2/device/{id}/tags` | List devices, set tags on subnet routers |
| `dns:read` | `GET /api/v2/tailnet/{tailnet}/dns/records` | Discover panel endpoints via MagicDNS |
| `dns:write` | `PUT /api/v2/tailnet/{tailnet}/dns/records` | Register panel endpoints in DNS |
| `acls:write` | `PUT /api/v2/acl` | Configure autoApprovers for subnet routes |

**Confidence: HIGH** -- based on official Tailscale OAuth docs (published 2026-01-05) and API reference.

---

### Multi-Panel Communication Protocol

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom REST API over Tailscale mesh | -- | Inter-panel communication | Panels communicate over Tailscale's WireGuard mesh (encrypted, zero-config, NAT-traversal). Each panel exposes a set of API routes that other panels call via Tailscale IPs (100.x.y.z). No additional library needed. |
| Tailscale Webhooks (incoming) | -- | Receive Tailscale network events | Subscribe to `nodeCreated`, `nodeDeleted`, `nodeNeedsApproval` events. Verify signatures with HMAC-SHA256 using webhook secret. Process via existing API route handler. |

**Why no gRPC, MQTT, or message queue:**

| Alternative | Why rejected |
|-------------|-------------|
| gRPC | Overkill for 1-3 panels. Adds protobuf dependency, code generation complexity. |
| MQTT | Requires a broker (Mosquitto/EMQX). Another service to run and maintain. |
| Redis Pub/Sub | Requires Redis. Current stack is SQLite-only, no Redis. |
| WebSockets (Socket.io) between panels | Socket.io is for browser-to-server. Panel-to-panel is better as REST + webhooks (request/response semantics, idempotent, retry-friendly). |

**Inter-panel API design (new API routes on each panel):**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/panel/health` | GET | Liveness check, returns panel version and status |
| `/api/panel/config/push` | POST | Receive chain configuration push from central panel |
| `/api/panel/config/pull` | GET | Return current panel configuration (for central to poll) |
| `/api/panel/config/ack` | POST | Acknowledge config push, return applied status |
| `/api/panel/chain/apply` | POST | Apply received chain routing config to local VPN services |
| `/api/panel/status` | GET | Return current chain status, node health, traffic stats |

**Transport security:** Tailscale provides WireGuard encryption end-to-end. No need for mTLS between panels. HMAC signature on config pushes for authenticity verification (same pattern as Tailscale webhooks).

**Confidence: HIGH** -- design decision based on project constraints (1-3 panels, single admin, no additional infrastructure). Pattern is standard for control-plane / managed-node architecture.

---

### Chain Routing Engine

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Existing `src/lib/chain-router.ts` | -- | Chain config generation | Already generates WireGuard peer configs and Xray routing rules from templates. Needs extension for multi-panel distribution, not replacement. |
| Zod (existing) | 4.3+ | Config validation | Already in the project. Use Zod schemas to validate chain configs before push and on receipt. Ensures type safety across panel boundaries. |

**No new library needed for the routing engine.** The existing `chain-router.ts` already handles:
- Linear, split, and mesh topologies
- WireGuard peer generation
- Xray routing rule generation

What changes for v1.1:
1. `applyChainConfig()` -- currently a stub that logs -- becomes the real push mechanism (HTTP POST to remote panel APIs)
2. New `distributeChainConfig()` -- central panel fans out config to all chain nodes
3. New `verifyChainApplication()` -- confirms remote panels applied config successfully

**Confidence: HIGH** -- based on existing codebase analysis.

---

### Pre-Configuration Template System

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Prisma ORM (existing) | 7.8+ | Template persistence | `ConfigTemplate` model already exists in schema. Add a `TemplateCategory` enum (VPN_PROTOCOL, SERVER_PRESET, ROUTING_PRESET, CHAIN_TOPOLOGY) and a `version` field for template versioning. |
| Existing `src/lib/chain-templates.ts` | -- | Built-in chain topology templates | 4 built-in templates already defined (2-hop, 3-hop, split routing, mesh). Move from in-memory constants to DB-seeded records for consistency with config templates. |
| Existing `src/lib/config-templates.ts` | -- | CRUD for config templates | Already provides create/read/update/delete with Prisma. Extend with category filtering and import/export. |
| Existing `src/lib/protocol-templates.ts` | -- | Protocol default templates | 7 built-in protocol templates (AmneziaWG, VLESS-XTLS-Vision, etc.). Already seeds to DB on startup. |

**Template system additions (no new libraries):**

| Addition | Implementation |
|----------|---------------|
| Template categories | New `templateCategory` column on `ConfigTemplate` (VPN_PROTOCOL, SERVER_PRESET, ROUTING_PRESET, CHAIN_TOPOLOGY) |
| Template versioning | New `version` Int column with auto-increment on update |
| Template export/import | JSON serialization of template + content, Zod validation on import |
| Chain template DB persistence | Migrate `BUILTIN_CHAIN_TEMPLATES` from in-memory to DB-seeded (same pattern as protocol-templates.ts) |

**Confidence: HIGH** -- based on existing codebase patterns and Prisma schema.

---

### Environment Variables (new for v1.1)

| Variable | Required | Purpose |
|----------|----------|---------|
| `TAILSCALE_OAUTH_CLIENT_ID` | Yes | Tailscale OAuth client ID for API access |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Yes | Tailscale OAuth client secret |
| `TAILSCALE_TAILNET_NAME` | Yes | Tailnet identifier (e.g., `example.ts.net` or `-` for auto) |
| `PANEL_API_SECRET` | Yes | HMAC secret for inter-panel config push verification |
| `PANEL_ROLE` | Yes | `central` or `local` -- determines panel behavior |
| `CENTRAL_PANEL_URL` | If local | Tailscale hostname/IP of central panel for registration |

---

## Prisma Schema Additions

```prisma
// New enum
enum TemplateCategory {
  VPN_PROTOCOL
  SERVER_PRESET
  ROUTING_PRESET
  CHAIN_TOPOLOGY
}

enum PanelRole {
  CENTRAL
  LOCAL
}

// Extend existing ConfigTemplate
model ConfigTemplate {
  // ... existing fields ...
  category    TemplateCategory @default(VPN_PROTOCOL)
  version     Int              @default(1)
}

// New model: Remote Panel registration
model RemotePanel {
  id          Int      @id @default(autoincrement())
  name        String
  tailscaleIP String   // 100.x.y.z address
  role        PanelRole @default(LOCAL)
  apiSecret   String   // HMAC secret for this panel
  lastSeenAt  DateTime?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("remote_panels")
}

// New model: Chain config push audit
model ChainPushLog {
  id            Int      @id @default(autoincrement())
  chainConfigId Int
  targetPanelId Int
  status        String   @default("pending") // pending, applied, failed
  response      String?  // Remote panel response
  pushedAt      DateTime @default(now())
  acknowledgedAt DateTime?

  @@index([chainConfigId])
  @@index([status])
  @@map("chain_push_logs")
}

// New model: Chain configuration (persistent)
model ChainConfiguration {
  id          Int      @id @default(autoincrement())
  name        String
  templateId  String
  topology    String   // linear, split, mesh
  config      Json     // Full resolved chain config
  isActive    Boolean  @default(false)
  appliedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  pushLogs    ChainPushLog[]

  @@map("chain_configurations")
}
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Tailscale HTTP client | Native `fetch` with custom wrapper | `@tailscale/connect` (WASM SDK) | Abandoned (2 years, 0 dependents, 32MB WASM). Embedding a full Tailscale node in the panel is wrong architecture -- we manage Tailscale via API, not embed it. |
| Tailscale HTTP client | Native `fetch` with custom wrapper | `axios` | Already in alternatives in v1.0 research but never added. Native `fetch` (Node 20+) eliminates dependency. For retry logic, `undici` (built into Next.js) handles retries via `fetch`. |
| Tailscale auth | OAuth client credentials | Long-lived API key | API keys expire after 90 days max, are broad-scoped, and require manual rotation. OAuth gives scoped, auto-rotating tokens. |
| Tailscale auth | OAuth client credentials | Workload Identity Federation | Requires OIDC provider setup (GitHub Actions, GCP, AWS). Overkill for 1-3 servers managed by a single admin. |
| Inter-panel protocol | REST over Tailscale mesh | gRPC | Adds protobuf dependency and code generation. Over-engineered for 1-3 panels. |
| Inter-panel protocol | REST over Tailscale mesh | MQTT with broker | Requires running a message broker. Violates single-server, zero-config constraint. |
| Inter-panel protocol | REST over Tailscale mesh | Redis Pub/Sub | No Redis in current stack. Would require adding Redis as a dependency. |
| Template storage | Prisma/SQLite (extend existing) | Separate JSON files on disk | Loses queryability, no relations to other models, harder to manage CRUD. |
| Template storage | Prisma/SQLite (extend existing) | Dedicated template service (microservice) | Violates single-server architecture. Prisma handles this fine at our scale. |

---

## Installation

```bash
# No new npm packages needed for v1.1.
# All new capabilities use existing dependencies:
# - fetch (Node.js built-in)
# - zod (existing, ^4.3.6)
# - prisma (existing, ^7.8.0)
# - socket.io (existing, ^4.8.3)

# Prisma migration for new models:
npx prisma migrate dev --name v11_multi_panel_chain_routing

# Environment variables to add to .env:
# TAILSCALE_OAUTH_CLIENT_ID=<from-tailscale-admin-console>
# TAILSCALE_OAUTH_CLIENT_SECRET=<from-tailscale-admin-console>
# TAILSCALE_TAILNET_NAME=<your-tailnet>.ts.net
# PANEL_API_SECRET=<generate-random-hmac-secret>
# PANEL_ROLE=central  # or "local"
# CENTRAL_PANEL_URL=  # only for local panels
```

---

## What NOT to Add

| Library | Why NOT |
|---------|---------|
| `@tailscale/connect` | Abandoned WASM SDK, wrong architecture. We call Tailscale API, we don't embed Tailscale. |
| `axios` | Native `fetch` handles our needs. One less dependency. |
| `ssh2` | Tailscale mesh replaces SSH for inter-panel communication. No SSH needed between panels. |
| `amnestrap` / `xray-parser` (hypothetical) | No such mature libraries exist. We parse config formats ourselves (already doing this in chain-router.ts). |
| `handlebars` / `ejs` / template engines | Templates are JSON config objects, not text templates. Zod validation + JSON merge is sufficient. |
| Redis / message queue | 1-3 panels, single admin. REST push + webhooks is sufficient. No event streaming needed. |
| `bull` / job queue | Chain config push is synchronous HTTP request. No background job processing needed at this scale. |

---

## Integration Points with Existing Stack

### Tailscale Client <-> Existing Server Model
The existing `Server` model (`prisma/schema.prisma`) stores `hostname`, `port`, and `apiKeyHash`. For v1.1, servers that are panel nodes will additionally have their Tailscale IP stored in the new `RemotePanel` model. The `Server` model remains for non-panel VPN servers.

### Tailscale Client <-> Existing Auth
The existing JWT auth (jose) protects the panel's own API routes. Inter-panel communication uses a separate HMAC secret (`PANEL_API_SECRET`) -- this is NOT the admin JWT. Remote panels authenticate config pushes with HMAC signatures, independent of the admin login system.

### Chain Router <-> Server Connection
The existing `src/lib/server-connection.ts` provides `testConnection()` (ping-based) and `executeOnServer()` (stubbed SSH). For v1.1, replace the SSH stub with HTTP calls to remote panel APIs over Tailscale IPs. The `testConnection()` function gains a Tailscale health check variant.

### Template System <-> Prisma
The existing `ConfigTemplate` model already stores protocol templates. Adding `category` and `version` columns is a non-breaking migration. Existing protocol templates get `category: VPN_PROTOCOL`. Chain topology templates (currently in-memory in `chain-templates.ts`) become `category: CHAIN_TOPOLOGY` records.

### Webhooks <-> Socket.io
Tailscale webhooks (nodeCreated, nodeDeleted) arrive at a new API route. On processing, emit events through the existing Socket.io instance so the dashboard updates in real-time. This follows the existing pattern of server-side events flowing to the client via WebSocket.

---

## Sources

- [Tailscale OAuth Clients (official docs, published 2026-01-05)](https://tailscale.com/kb/1215/tailscale-connect) -- HIGH confidence
- [Tailscale Subnet Routers (official docs, validated 2026-02)](https://tailscale.com/kb/1019/subnet-routers) -- HIGH confidence
- [Tailscale Webhooks (official docs)](https://tailscale.com/kb/1213/webhooks) -- HIGH confidence
- [Tailscale API Reference](https://tailscale.com/api) -- HIGH confidence (endpoint list verified via API docs page)
- [@tailscale/connect npm (published 2023, abandoned)](https://www.npmjs.com/package/@tailscale/connect) -- HIGH confidence (0 dependents, 2 years stale)
- [Tailscale API Key vs OAuth comparison](https://tailscale.com/docs/features/oauth-clients) -- HIGH confidence
- [Tailscale Workload Identity Federation](https://tailscale.com/blog/workload-identity-beta) -- MEDIUM confidence (blog post, not needed for our scale)
- [Tailscale API endpoints (from tscli Go client reference)](https://github.com/jaxxstorm/tscli) -- LOW confidence (third-party tool, but endpoint list corroborated with official docs)
