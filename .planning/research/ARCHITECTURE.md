# Architecture Patterns

**Domain:** Web-based VPN admin control panel -- multi-panel chain routing (v1.1)
**Researched:** 2026-04-29
**Previous version:** 2026-04-27 (v1.0 single-panel architecture)

## Current State (v1.0)

Single-panel Next.js app. API routes talk to local VPN services via shell commands. SQLite via Prisma. Socket.io for browser-only real-time updates. All chain/geo functionality exists but is stubbed (no real remote execution, no GeoIP integration, in-memory stores for geo rules).

```
Browser <-> Next.js API Routes <-> Shell Commands <-> Local VPN Services
                  |
             SQLite/Prisma
```

**What changes in v1.1:** The central panel must push chain configurations to remote panels over Tailscale mesh. Remote panels are independent Next.js instances running on other VPN servers. Geo-routing and chain templates must be persisted and synced.

---

## Recommended Architecture (v1.1)

```
                         Central Panel (this Next.js instance)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Browser UI                                                          │
  │  ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐   │
  │  │ Chain      │ │ Multi-Panel  │ │ Geo-Routing│ │ Template     │   │
  │  │ Builder    │ │ Manager      │ │ Rules      │ │ Editor       │   │
  │  └────────────┘ └──────────────┘ └────────────┘ └──────────────┘   │
  │                          │                                           │
  │  API Routes ─────────────┤                                           │
  │  ┌────────────┐ ┌────────┴───────┐ ┌────────────┐ ┌──────────────┐  │
  │  │ /api/      │ │ PanelSync     │ │ Chain      │ │ GeoRouting   │  │
  │  │ panels/*   │ │ Service       │ │ Router     │ │ Service      │  │
  │  └────────────┘ └────────────────┘ └────────────┘ └──────────────┘  │
  │       │                 │                  │                         │
  │  ┌────┴─────────────────┴──────────────────┴───────────────────────┐ │
  │  │              SQLite/Prisma (central DB)                         │ │
  │  │  RemotePanel │ ChainConfig │ GeoRoutingRule │ Template          │ │
  │  └────────────────────────────────────────────────────────────────┘ │
  │       │                                                             │
  │  PanelSyncClient ───────── HTTP over Tailscale mesh ──────────>    │
  └──────────────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┼───────────┐
              │ Tailscale Mesh Network │
              │ (private, encrypted)  │
              └───────────┼───────────┐
                          │
  ┌───────────────────────┼───────────────────────┐
  │ Remote Panel A        │ Remote Panel B        │
  │ ┌───────────────────┐ │ ┌───────────────────┐ │
  │ │ /api/sync/*       │ │ │ /api/sync/*       │ │
  │ │ (receive push)    │ │ │ (receive push)    │ │
  │ ├───────────────────┤ │ ├───────────────────┤ │
  │ │ Local SQLite     │ │ │ Local SQLite     │ │
  │ ├───────────────────┤ │ ├───────────────────┤ │
  │ │ Local VPN Svc    │ │ │ Local VPN Svc    │ │
  │ └───────────────────┘ │ └───────────────────┘ │
  └───────────────────────┴───────────────────────┘
```

### Component Boundaries

#### New Components (v1.1)

| Component | File | Responsibility | Communicates With |
|-----------|------|----------------|-------------------|
| PanelSyncClient | `src/lib/panel-sync-client.ts` | HTTP push client -- sends chain configs, geo rules, template updates to remote panels via Tailscale | Remote panel `/api/sync/*` routes |
| PanelSyncReceiver | `src/app/api/sync/[action]/route.ts` | API routes that receive pushed configs from central panel | PanelSyncClient (HTTP), local Prisma, local chain-router |
| RemotePanel Service | `src/lib/remote-panel.ts` | CRUD for registered remote panels (stored in Prisma) | Central Prisma DB |
| TailscaleManager | `src/lib/tailscale-manager.ts` | Check Tailscale status, verify mesh connectivity, manage subnet routes | `tailscale` CLI via execFile (same pattern as vpn-services.ts) |
| GeoRouting Service | `src/lib/geo-routing-service.ts` | Persisted geo-routing rules (replaces in-memory stub), GeoIP lookup | Prisma GeoRoutingRule model, external GeoIP API |
| TemplateSync Service | `src/lib/template-sync.ts` | Sync chain templates and config presets to remote panels | PanelSyncClient, remote `/api/sync/*` |

#### Modified Components (v1.1)

| Component | Current State | v1.1 Change |
|-----------|---------------|-------------|
| `prisma/schema.prisma` | No multi-panel models | Add: RemotePanel, ChainConfig (persisted), GeoRoutingRule models |
| `src/lib/chain-router.ts` | Stub -- logs instead of applying | Replace stubs with real config push via PanelSyncClient |
| `src/lib/geo-routing.ts` | In-memory evaluation, stub GeoIP | Use persisted rules from DB, integrate real GeoIP (MaxMind or ip-api.com) |
| `src/lib/server-connection.ts` | Ping-based test, SSH is stub | Use Tailscale connectivity instead of SSH for panel-to-panel |
| `src/lib/websocket.ts` | Browser-only broadcasts | Add inter-panel event types: `panel:status`, `config:pushed`, `chain:updated` |
| `src/lib/chain-templates.ts` | Hardcoded TypeScript array | Keep built-in templates in code, add user-created templates to DB |
| `src/lib/config-templates.ts` | CRUD only for local panel | Add `syncToPanels()` method for multi-panel distribution |

#### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| `src/lib/vpn-services.ts` | Local VPN CLI -- each panel manages its own local services |
| `src/lib/auth.ts` | Auth is local to each panel -- no shared sessions |
| `src/lib/rule-enforcement.ts` | Local rule evaluation -- rules pushed from central, applied locally |
| `src/lib/user-sync.ts` | Local user sync between AWG and 3x-ui on same server |
| `src/lib/real-time-broadcaster.ts` | Local broadcasting -- no inter-panel event propagation needed |

---

## Data Flow

### Flow 1: Register a Remote Panel

```
Admin UI  -->  POST /api/panels (central)
             --> Validate Tailscale reachability (TailscaleManager)
             --> Store RemotePanel in central DB
             --> Push current chain templates + geo rules to remote
             --> Return panel record to UI
```

### Flow 2: Push Chain Configuration

```
Admin UI  -->  POST /api/chains/apply (central)
             --> Generate chain config (chain-router.ts -- existing logic)
             --> For each node in chain:
                  --> If node is on a remote panel:
                       --> PanelSyncClient.pushChainConfig(panelUrl, chainConfig)
                       --> POST https://<panel-tailscale-ip>:3000/api/sync/chain
                       --> Remote panel stores + applies locally
                  --> If node is local:
                       --> Apply directly (chain-router.ts local path)
             --> Return success/failure per node
```

### Flow 3: Push Geo-Routing Rules

```
Admin UI  -->  PUT /api/geo-rules (central)
             --> Upsert rules in central DB
             --> PanelSyncClient.pushGeoRules(panelUrl, rules)
             --> POST https://<panel-tailscale-ip>:3000/api/sync/geo-rules
             --> Remote panel stores rules locally
             --> Remote panel re-evaluates active rules
```

### Flow 4: Sync Templates

```
Admin UI  -->  POST /api/templates/sync (central)
             --> Get all templates (built-in + user-created)
             --> For each remote panel:
                  --> PanelSyncClient.pushTemplates(panelUrl, templates)
                  --> POST https://<panel-tailscale-ip>:3000/api/sync/templates
             --> Return sync status per panel
```

### Flow 5: GeoIP Lookup (Real)

```
User traffic  -->  Geo-routing evaluation
                --> lookupGeoIP(destinationIP)
                --> Cache check (in-memory, 5-min TTL)
                --> If cache miss: fetch from ip-api.com or MaxMind DB
                --> Classify domestic/foreign
                --> Match against persisted GeoRoutingRule
                --> Return ROUTE action with chainId or ALLOW/BLOCK
```

---

## Tailscale Integration Architecture

### Why Tailscale (not SSH)

The existing `server-connection.ts` uses ping-based tests and stubs SSH. For v1.1 multi-panel, Tailscale provides:

1. **Zero-config networking** -- no SSH key management, no port forwarding
2. **Private mesh** -- all panel-to-panel traffic encrypted by Tailscale
3. **Built-in auth** -- Tailscale node keys + tailnet ACLs
4. **Subnet routing** -- each panel advertises its local VPN subnet to other panels
5. **NAT traversal** -- works behind firewalls without port opening

### TailscaleManager Component

```typescript
// src/lib/tailscale-manager.ts
interface TailscaleStatus {
  isRunning: boolean;
  nodeId: string;
  ipAddress: string;       // 100.x.x.x Tailscale IP
  hostname: string;
  isOnline: boolean;
  advertisedRoutes: string[];
}

interface TailscaleManager {
  getStatus(): Promise<TailscaleStatus>;
  setAdvertisedRoutes(routes: string[]): Promise<void>;
  checkPeerReachability(tailscaleIP: string): Promise<boolean>;
  getPeerInfo(tailscaleIP: string): Promise<TailscalePeer | null>;
}
```

**Implementation:** Thin wrapper around `tailscale status --json` and `tailscale set --advertise-routes=...`. Use `execFile` from `child_process` with array-based arguments (same pattern as `vpn-services.ts` `runCommand`). Never use `exec()` with string interpolation.

### Subnet Router Setup

Each remote panel runs Tailscale and advertises its VPN client subnet:

```bash
# On each VPN server running a panel:
tailscale set --advertise-routes=10.8.0.0/24  # AWG client subnet
tailscale set --advertise-routes=172.16.0.0/24  # Xray client subnet
# Plus enable IP forwarding in kernel
sysctl -w net.ipv4.ip_forward=1
```

Admin console approval required for subnet routes. This is a one-time setup per server.

### Panel-to-Panel Auth

Each panel has an API key stored in its environment. Central panel stores API keys for remote panels in the RemotePanel model. Push requests include `Authorization: Bearer <panel-api-key>`.

```
Central Panel                              Remote Panel
    |                                          |
    |  POST /api/sync/chain                    |
    |  Authorization: Bearer <remote-api-key>  |
    |  X-Panel-ID: <central-panel-id>          |
    |  X-Signature: <hmac-sha256>              |
    |----------------------------------------->|
    |                                          | Verify API key
    |                                          | Verify HMAC signature
    |                                          | Store + apply config
    |  200 OK                                  |
    |<-----------------------------------------|
```

---

## Schema Changes (Prisma)

### New Models

```prisma
// ─── Remote Panel ─────────────────────────────────────

model RemotePanel {
  id          Int      @id @default(autoincrement())
  name        String
  tailscaleIP String   @unique          // 100.x.x.x
  panelPort   Int      @default(3000)   // Next.js port
  apiKeyHash  String                    // hash of API key for auth
  role        PanelRole @default(REMOTE)
  lastSyncAt  DateTime?
  status      PanelStatus @default(UNKNOWN)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  chainConfigs ChainConfig[]

  @@map("remote_panels")
}

enum PanelRole {
  CENTRAL
  REMOTE
}

enum PanelStatus {
  ONLINE
  OFFLINE
  UNKNOWN
  SYNCING
}

// ─── Chain Config (persisted) ─────────────────────────

model ChainConfig {
  id            Int      @id @default(autoincrement())
  name          String
  templateId    String                    // references chain-templates.ts id
  topology      String                    // linear | split | mesh
  config        Json                      // full resolved config
  isActive      Boolean  @default(true)
  appliedAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  nodes         ChainNode[]
  remotePanel   RemotePanel? @relation(fields: [panelId], references: [id])
  panelId       Int?
  geoRules      GeoRoutingRule[]

  @@map("chain_configs")
}

model ChainNode {
  id          Int      @id @default(autoincrement())
  chainId     Int
  label       String
  role        String                   // entry | exit | middle | domestic | foreign
  protocol    String                   // wireguard | xray
  serverId    Int?                     // local VPN server ID
  panelId     Int?                     // null = local panel, otherwise RemotePanel.id
  hostname    String
  port        Int

  chain       ChainConfig @relation(fields: [chainId], references: [id], onDelete: Cascade)

  @@map("chain_nodes")
}

// ─── Geo Routing Rule (persisted) ──────────────────────

model GeoRoutingRule {
  id          Int           @id @default(autoincrement())
  target      String        // country code, region, "domestic", "foreign"
  targetType  GeoTargetType @default(COUNTRY)
  action      RoutingAction @default(ALLOW)
  chainId     Int?          // route to this chain config if action=ROUTE
  priority    Int           @default(0)
  isActive    Boolean       @default(true)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  chain       ChainConfig?  @relation(fields: [chainId], references: [id])

  @@index([priority])
  @@index([isActive])
  @@map("geo_routing_rules")
}

enum GeoTargetType {
  COUNTRY
  REGION
  SPECIAL    // domestic/foreign
  IP_RANGE
  HOSTNAME
}
```

### Existing Model Changes

The existing `Server` model refers to VPN servers, not admin panels. It stays unchanged. The new `RemotePanel` model is a separate concept -- a remote panel IS a VPN server but also runs the control panel.

The existing `RoutingRule` model stays for per-user routing rules. `GeoRoutingRule` is a separate model for geo-based traffic distribution that operates at the chain level, not per-user level.

---

## Patterns to Follow

### Pattern 1: Push with Acknowledgment
**What:** Central panel pushes config, waits for acknowledgment, retries on failure.
**When:** All config synchronization between central and remote panels.
**Why:** Ensures config consistency. Remote panels can reject invalid configs.
```typescript
// src/lib/panel-sync-client.ts
async pushChainConfig(
  panel: RemotePanel,
  chainConfig: ChainConfig,
  retries = 3
): Promise<SyncResult> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = await fetch(`https://${panel.tailscaleIP}:${panel.panelPort}/api/sync/chain`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.getApiKey(panel)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chainConfig),
    });

    if (result.ok) return { success: true };
    if (attempt < retries) await sleep(1000 * attempt);
  }
  return { success: false, error: 'Max retries exceeded' };
}
```

### Pattern 2: Local-First with Sync
**What:** Remote panels operate autonomously with local DB. Central pushes updates, remote applies locally.
**When:** All panel operations. Remote panel must work even if central goes down.
**Why:** Hybrid model from PROJECT.md -- central coordination + local autonomy. If central panel goes offline, remote panels continue serving VPN traffic with their last-known-good config.
```typescript
// Remote panel sync receiver stores locally, then applies
// src/app/api/sync/chain/route.ts
export async function POST(request: NextRequest) {
  const chainConfig = await request.json();
  // 1. Validate
  // 2. Store in local DB
  await prisma.chainConfig.upsert({ ... });
  // 3. Apply to local VPN services
  await applyChainConfigLocally(chainConfig);
  // 4. Acknowledge
  return Response.json({ success: true });
}
```

### Pattern 3: GeoIP with Cache
**What:** GeoIP lookups cached in-memory with TTL. Persisted rules evaluated from DB.
**When:** Every traffic routing decision involving geo rules.
**Why:** Avoid hitting rate-limited external APIs on every request. DB persistence fixes v1.0 tech debt.
```typescript
// src/lib/geo-routing-service.ts
const geoCache = new Map<string, { result: GeoIPResult; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async lookupWithCache(ip: string): Promise<GeoIPResult> {
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = await fetchGeoIP(ip); // real API call
  geoCache.set(ip, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
```

### Pattern 4: Template Versioning
**What:** Built-in templates versioned in code. User templates versioned in DB with updatedAt timestamp. Sync includes version hash.
**When:** Template sync to remote panels. Avoid overwriting newer templates with older ones.
```typescript
// Only push if remote has older version
if (remoteTemplate.updatedAt < localTemplate.updatedAt) {
  await pushTemplate(panel, localTemplate);
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Two-Way Sync (Bidirectional)
**What:** Remote panels push changes back to central, central pushes to remotes -- bidirectional sync.
**Why bad:** Conflict resolution becomes intractable at this scale. Split-brain, last-write-wins, data loss.
**Instead:** Central push only. Remote panels receive and apply. If admin needs to change remote config, they do it from central panel. This matches the "central push model" decision in PROJECT.md.

### Anti-Pattern 2: Shared Database
**What:** All panels read/write the same SQLite file (e.g., via NFS or Tailscale file sharing).
**Why bad:** SQLite does not support concurrent writes from multiple processes over network. WAL mode helps locally but fails over NFS.
**Instead:** Each panel has its own local SQLite. Central pushes config data via HTTP API. Each panel stores its own copy.

### Anti-Pattern 3: WebSocket for Config Sync
**What:** Use Socket.io to stream config changes between panels in real-time.
**Why bad:** Adds complexity (persistent connections, reconnection handling) for low-frequency config changes. HTTP push with retry is simpler and more reliable.
**Instead:** HTTP POST for config push. WebSocket remains for browser-only dashboard updates.

### Anti-Pattern 4: Monolithic Chain Config
**What:** Single giant config object containing all chain definitions pushed to all panels.
**Why bad:** A remote panel only needs configs for chains where it has a node. Pushing everything wastes bandwidth and creates unnecessary coupling.
**Instead:** Push only relevant chain node configs to each remote panel. The central panel knows which panel owns which node from the ChainNode.panelId field.

### Anti-Pattern 5: Direct Tailscale API Calls
**What:** Use Tailscale's HTTP API (api.tailscale.com) for panel-to-panel communication.
**Why bad:** Requires API tokens, goes through Tailscale's servers (latency), rate limited. Overkill for internal mesh communication.
**Instead:** Panels communicate directly via their Tailscale IP addresses (100.x.x.x). No API needed -- just HTTP over the Tailscale wireguard tunnel.

---

## Scalability Considerations

| Concern | Current (1 panel) | v1.1 (2-3 panels) | Future (10+ panels) |
|---------|-------------------|---------------------|---------------------|
| Config sync | N/A | HTTP push per panel (seconds) | Batch push + queue (Redis pub/sub) |
| Database | Single SQLite | One SQLite per panel | Consider PostgreSQL per panel |
| Real-time | Socket.io to browsers | Same + optional inter-panel events | Redis-backed Socket.io adapter |
| Tailscale | Not used | 2-3 nodes in tailnet | Tailscale scales to thousands of nodes |
| GeoIP | Stub | Cached API calls (ip-api.com, 45 req/min free) | Local MaxMind DB (no rate limit) |
| Chain topology | Up to 3 nodes | Same | 10+ nodes = need path computation |

**v1.1 stays within the 1-3 panel constraint.** No premature optimization for 10+ panels.

---

## New vs Modified Components: Build Order

Build order respects dependencies. Each step can be a separate phase.

```
Phase A: Tailscale Foundation
  ├── TailscaleManager (new, src/lib/tailscale-manager.ts)
  └── Subnet router setup docs/script
  Depends on: Nothing. Pure utility wrapper around tailscale CLI.
  Blocks: Everything else needs Tailscale connectivity.

Phase B: Schema + Data Layer
  ├── Prisma schema migrations (new models: RemotePanel, ChainConfig, ChainNode, GeoRoutingRule)
  ├── Seed script updates
  └── RemotePanel CRUD service (new, src/lib/remote-panel.ts)
  Depends on: Phase A (for TailscaleManager reachability check during panel registration).
  Blocks: Phase C, D, E.

Phase C: Panel Sync Protocol
  ├── PanelSyncClient (new, src/lib/panel-sync-client.ts)
  ├── Sync receiver API routes (new, src/app/api/sync/chain/route.ts, etc.)
  └── HMAC signature verification
  Depends on: Phase B (RemotePanel model for API key storage).
  Blocks: Phase D, E (push mechanism).

Phase D: Persisted Geo-Routing
  ├── GeoRoutingService (new, src/lib/geo-routing-service.ts)
  ├── Real GeoIP integration (MaxMind or ip-api.com)
  └── Geo routing API routes (CRUD)
  Depends on: Phase B (GeoRoutingRule model).
  Independent of: Phase C (geo rules can be local-only initially).

Phase E: Chain Config Push
  ├── Upgrade chain-router.ts (replace stubs with real push)
  ├── Template sync service (new, src/lib/template-sync.ts)
  └── Chain apply API route updates
  Depends on: Phase B, Phase C (push mechanism).
  Final integration: wire up chain builder UI -> chain-router -> panel sync.

Phase F: UI (Multi-Panel Management)
  ├── Panel registration page
  ├── Panel status dashboard
  ├── Chain builder with multi-panel awareness
  └── Geo-routing rules editor
  Depends on: Phase B, C, D, E (all backend endpoints).
```

**Critical path:** A -> B -> C -> E -> F (geo-routing D is parallel with C).

---

## Integration Points Summary

| Integration Point | From | To | Mechanism |
|-------------------|------|----|-----------|
| Chain config push | Central panel | Remote panels | HTTP POST over Tailscale |
| Geo rule sync | Central panel | Remote panels | HTTP POST over Tailscale |
| Template sync | Central panel | Remote panels | HTTP POST over Tailscale |
| Panel health check | Central panel | Remote panels | Tailscale ping (100.x.x.x) |
| Local VPN config apply | chain-router.ts | vpn-services.ts | Shell commands (local only) |
| GeoIP lookup | geo-routing-service.ts | External API | HTTP GET (with cache) |
| Browser real-time | websocket.ts | Browser clients | Socket.io (unchanged) |
| Admin auth | auth middleware | API routes | JWT httpOnly cookie (unchanged) |

---

## Sources

- Existing codebase analysis (prisma/schema.prisma, src/lib/*.ts) -- HIGH confidence
- Tailscale subnet router docs: https://tailscale.com/docs/features/subnet-routers/how-to/setup -- MEDIUM confidence (fetched successfully during research)
- Tailscale CLI reference: `tailscale set --advertise-routes` -- HIGH confidence (official docs)
- PROJECT.md key decisions (Tailscale transport, central push, hybrid model) -- HIGH confidence
- Next.js server-to-server HTTP: `fetch()` in API routes / route handlers -- HIGH confidence (Next.js built-in)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Tailscale integration | HIGH | Simple CLI wrapper + HTTP over mesh. Well-documented. |
| Schema design | HIGH | Based on existing codebase patterns and Prisma capabilities. |
| Push sync protocol | HIGH | Standard HTTP POST with retry. Proven pattern. |
| GeoIP integration | MEDIUM | API choice (ip-api.com vs MaxMind) needs implementation decision. Rate limits matter at scale. |
| Chain config application | MEDIUM | Depends on replacing stubs in chain-router.ts. Actual WireGuard/Xray config format may need iteration. |
| Template sync | HIGH | Straightforward JSON serialization + HTTP push. |
| Build order | HIGH | Dependency graph is clear and linear. |
