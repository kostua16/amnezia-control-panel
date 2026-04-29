# Project Research Summary

**Project:** Amnezia Control Panel -- v1.1 Multi-Panel Chain Routing
**Domain:** Web-based VPN admin control panel (multi-panel extension)
**Researched:** 2026-04-29
**Confidence:** HIGH

## Executive Summary

Amnezia Control Panel is a Next.js-based admin interface for managing Amnezia AWG and 3x-ui VPN services. v1.1 extends the existing single-panel system to support multi-panel chain routing: a central panel coordinates 1-3 remote panels over a Tailscale mesh, pushing chain configurations, geo-routing rules, and templates to remote VPN servers. The product fits the "single-admin, multi-node control plane" pattern -- think DrayTek CVM or GL.iNet managed VPN, but self-hosted.

The research converges on a clear approach: use Tailscale as the exclusive transport layer (encrypted WireGuard mesh, zero-config, no additional infrastructure), extend the existing SQLite/Prisma data layer with new models for remote panels and chain configurations, and implement a central-push-only sync model (no bidirectional sync, no shared database). No new npm dependencies are needed -- all v1.1 capabilities use native `fetch` for Tailscale API calls and the existing stack. The architecture follows a clear dependency chain: Tailscale foundation first, then data models, then sync protocol, then geo-routing and chain push, and finally UI.

The primary risks cluster around Tailscale networking pitfalls (SNAT hiding source IPs, overlapping subnet routes causing black holes, MTU collapse from double encapsulation) and distributed consistency (split-brain during partial config apply, in-memory state loss on restart). All are preventable with documented mitigations, but require disciplined implementation. The geo-routing subsystem carries moderate uncertainty around GeoIP provider choice and performance.

## Key Findings

### Recommended Stack

v1.1 adds zero new dependencies. All capabilities are built on the existing validated stack (Next.js 16.2, React 19, Prisma 7.8, SQLite, Socket.io, Zustand, Tailwind CSS 4, jose JWT, zod).

**New stack additions (all existing or built-in):**
- Native `fetch` (Node.js built-in): Tailscale REST API v2 client -- zero dependencies, typed with TypeScript, sufficient for ~6 endpoints
- Custom `src/lib/tailscale-client.ts`: Thin wrapper around fetch with OAuth token management and retry logic (~150-200 lines)
- Zod (existing): Validate chain configs before push and on receipt across panel boundaries
- Prisma (existing): Extend with RemotePanel, ChainConfiguration, ChainPushLog, GeoRoutingRule, TemplateCategory models

**Tailscale auth: OAuth Client Credentials** -- scoped access (`devices:core`, `dns:read`/`dns:write`, `acls:write`), auto-rotating 1-hour tokens. API keys rejected (broad scope, 90-day expiry). Workload Identity rejected (enterprise overkill for 1-3 servers).

**New environment variables:** `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`, `TAILSCALE_TAILNET_NAME`, `PANEL_API_SECRET`, `PANEL_ROLE` (`central`/`local`), `CENTRAL_PANEL_URL` (if local).

### Expected Features

**Must have (table stakes for multi-panel routing):**
- Remote panel registration -- admin adds panels by Tailscale IP with auth credentials
- Connection status monitoring -- real-time reachable/offline status per remote panel
- Chain config push from central to remote -- core value: define chain once, distribute to all nodes
- Apply chain configuration to VPN services -- replace existing `applyChainConfig` stub with real push
- Push status and error reporting -- per-node success/failure with error details
- Rollback of pushed configuration -- store previous config, one-click undo

**Should have (differentiators):**
- Hybrid autonomy model -- remote panels cache last-known-good config, operate independently when central is down
- Visual multi-panel chain map -- extend existing chain visualization with panel boundaries
- Geo-routing across chained servers -- route by destination country through specific chain hops (MaxMind GeoIP2 Lite)
- Tailscale subnet router as transport -- zero-config encrypted mesh without port forwarding
- Pre-configuration templates -- server presets (VPS provider defaults), routing presets (geo rule bundles), chain presets
- Config diff preview before push -- show admin exactly what will change
- Central health dashboard -- aggregate metrics from all remote panels

**Defer to v1.2+:**
- Bidirectional config sync, automatic failover, Tailscale-as-VPN-for-end-users, full audit log, remote panel auto-discovery, multi-admin RBAC

### Architecture Approach

The architecture follows a central-push model: one central panel coordinates 2-3 remote panels over Tailscale mesh. Each panel runs its own Next.js instance with a local SQLite database -- no shared database. Config flows unidirectionally (central to remote). Remote panels are autonomous and survive central disconnection.

**Major components:**
1. **TailscaleManager** (`src/lib/tailscale-manager.ts`) -- status checks, subnet route management, peer reachability via Tailscale CLI
2. **PanelSyncClient** (`src/lib/panel-sync-client.ts`) -- HTTP push client for chain configs, geo rules, templates to remote panels
3. **PanelSyncReceiver** (`src/app/api/sync/[action]/route.ts`) -- API routes on each panel that receive and apply pushed configs
4. **RemotePanel Service** (`src/lib/remote-panel.ts`) -- CRUD for registered remote panels in Prisma
5. **GeoRouting Service** (`src/lib/geo-routing-service.ts`) -- persisted geo-routing rules replacing v1.0 in-memory stub, with cached GeoIP lookups
6. **TemplateSync Service** (`src/lib/template-sync.ts`) -- sync templates to remote panels

**Key patterns:**
- Push with acknowledgment (retry on failure, per-node status)
- Local-first with sync (each panel autonomous, central pushes updates)
- GeoIP with cache (in-memory 5-min TTL, persisted rules from DB)
- Template versioning (compare timestamps, push only if remote is older)

**Anti-patterns explicitly avoided:** bidirectional sync, shared database across panels, WebSocket for config sync, monolithic chain config (push only relevant per-node configs), using Tailscale public API for panel-to-panel communication (use direct Tailscale IPs instead).

### Critical Pitfalls

1. **Tailscale SNAT hiding source IPs in VPN chains** -- disable SNAT for inter-panel links (`--snat-subnet-routes=false`), add return routes for `100.64.0.0/10`. Without this, geo-routing misclassifies traffic and return-path routing fails.

2. **Central push creates split-brain during partial apply** -- implement two-phase commit (prepare on all panels, then commit only if all acknowledge). Store previous config for rollback. Track config versions per panel to detect drift.

3. **VPN chain MTU collapse from double encapsulation** -- set explicit MTU per tunnel layer (`1500 - layers * 80`), apply MSS clamping at every tunnel entry point, never block ICMP Fragmentation Needed. Include MTU in chain template schema as required field.

4. **Overlapping subnet routes create routing black holes** -- design non-overlapping subnet allocation across panels. Tailscale does NOT fall back from specific to broader routes. Add subnet conflict detection to config push validation.

5. **In-memory geo-routing state lost on panel restart** -- persist to SQLite (pay off v1.0 tech debt). Add startup self-check that compares local config version against central's expected version.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Tailscale Foundation + Remote Panel Registration
**Rationale:** Everything else depends on Tailscale connectivity. This is the base layer with zero dependencies on other v1.1 features.
**Delivers:** TailscaleManager utility, RemotePanel Prisma model, panel registration API routes and UI, connection status monitoring.
**Addresses:** Remote panel registration, connection status (FEATURES table stakes)
**Avoids:** SNAT hiding source IPs (Pitfall 1), overlapping subnet routes (Pitfall 4), `--accept-routes` loops (Pitfall 5), auth key expiry (Pitfall 10), DERP relay latency (Pitfall 12)
**Implements:** TailscaleManager component, RemotePanel Service

### Phase 2: Panel Sync Protocol + Data Persistence
**Rationale:** The sync protocol is the backbone for all config distribution. Data persistence pays off v1.0 tech debt (in-memory stores) and is required before any real config push can work.
**Delivers:** PanelSyncClient, sync receiver API routes, HMAC signature verification, Prisma schema migrations (ChainConfig, ChainNode, GeoRoutingRule, ChainPushLog), persisted geo-routing rules replacing in-memory stubs, two-phase commit for config push.
**Addresses:** Chain config push, push status reporting, rollback, hybrid autonomy (FEATURES table stakes + differentiators)
**Avoids:** Split-brain partial apply (Pitfall 2), API auth without rotation (Pitfall 8), in-memory state loss (Pitfall 9), SQLite write contention (Pitfall 13)
**Implements:** PanelSyncClient, PanelSyncReceiver, persisted GeoRoutingRule model, RemotePanel CRUD

### Phase 3: Chain Config Push + Geo-Routing Integration
**Rationale:** Now that the sync protocol and data layer exist, wire up the real chain push mechanism and integrate GeoIP for geo-aware routing.
**Delivers:** Real `applyChainConfig` (replacing stub), per-panel chain config generation and push, MaxMind GeoIP2 Lite integration, geo-routing rule evaluation with real IP classification, geo-aware chain selection, config diff preview.
**Addresses:** Apply chain configuration to VPN services (FEATURES), geo-routing across chained servers (FEATURES differentiator), config diff preview (FEATURES differentiator)
**Avoids:** MTU collapse (Pitfall 3), GeoIP database staleness (Pitfall 6)
**Implements:** GeoRouting Service, template-sync, chain-router upgrade

### Phase 4: Templates + Multi-Panel UI
**Rationale:** Templates are the final layer of polish. Server presets, routing presets, and extended chain presets build on the chain push and geo-routing from Phase 3. The multi-panel management UI ties everything together.
**Delivers:** Server presets (VPS provider defaults), routing presets (geo rule bundles), extended chain presets, template export/import, visual multi-panel chain map, central health dashboard, config diff preview UI.
**Addresses:** Pre-configuration templates (FEATURES differentiator), visual multi-panel chain map, central health dashboard (FEATURES differentiators)
**Avoids:** Template variable injection producing invalid configs (Pitfall 7), protocol-agnostic template content (Pitfall 14), static server-role assumptions (Pitfall 11)
**Implements:** TemplateSync Service, multi-panel dashboard UI, chain visualization with panel boundaries

### Phase Ordering Rationale

- **Phase 1 is the prerequisite** for everything: no Tailscale connectivity means no panel-to-panel communication. The dependency graph from ARCHITECTURE.md confirms: TailscaleManager blocks all other components.
- **Phase 2 must come before Phase 3** because the sync protocol and data persistence are required infrastructure. Pushing configs without persistent storage would re-create v1.0's in-memory tech debt on remote panels.
- **Phase 3 can run geo-routing (D) in parallel with chain push (E)** per ARCHITECTURE.md, but combining them into one phase simplifies the roadmap. The critical path is A -> B -> C -> E -> F.
- **Phase 4 is last** because templates depend on chain push and geo-routing being functional. The multi-panel UI depends on all backend endpoints from Phases 1-3.
- **Phase ordering avoids pitfalls** by grouping Tailscale pitfalls together (Phase 1), sync pitfalls together (Phase 2), and chain/geo pitfalls together (Phase 3).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Tailscale CLI integration specifics (version-dependent flags, `tailscale set` syntax, subnet router approval workflow). Standard patterns exist but implementation details vary by Tailscale version.
- **Phase 3:** GeoIP provider decision (MaxMind GeoIP2 Lite MMDB vs ip-api.com free API) and MMDB integration with Node.js. MaxMind free tier terms may have changed. WireGuard/Xray config format specifics for `applyChainConfig` need real-service validation.

Phases with standard patterns (skip research-phase):
- **Phase 2:** HTTP push with retry, HMAC signature verification, Prisma schema extension, two-phase commit -- all well-established patterns with abundant reference material.
- **Phase 4:** Template CRUD, JSON validation, dashboard UI -- standard web development patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All additions use built-in or existing libraries. Tailscale API OAuth documented officially. |
| Features | HIGH | Feature set derived from existing codebase analysis (what's stubbed, what's in-memory) and domain reference products (DrayTek CVM, GL.iNet). Clear table stakes vs differentiators. |
| Architecture | HIGH | Component boundaries, data flows, and patterns derived from existing codebase. Tailscale integration architecture follows official docs. Build order dependency graph is clear. |
| Pitfalls | HIGH | 5 of 14 pitfalls confirmed by official Tailscale documentation. Remaining pitfalls are well-known distributed systems and WireGuard networking issues. Mitigation strategies are concrete and testable. |

**Overall confidence:** HIGH

### Gaps to Address

- **GeoIP provider selection:** MaxMind GeoIP2 Lite vs ip-api.com vs MaxMind Precision API. MaxMind Lite MMDB requires account registration and license agreement acceptance. ip-api.com free tier is 45 req/min (sufficient at this scale but limits burst). Decision needed during Phase 3 planning.
- **WireGuard/Xray config application specifics:** The `applyChainConfig` stub needs to be replaced with real config application. The exact WireGuard INI format and Xray JSON schema for multi-hop chains need validation against actual running services. Plan integration testing with real AWG and 3x-ui instances during Phase 3.
- **3x-ui REST API stability:** The Postman collection for 3x-ui API is community-maintained, not official. API endpoints may change between 3x-ui versions. Pin the supported 3x-ui version range in documentation.
- **Tailscale OAuth client provisioning:** The admin must manually create OAuth client in Tailscale admin console and configure scopes. No API-based provisioning. Document the setup steps clearly for Phase 1.

## Sources

### Primary (HIGH confidence)
- Tailscale OAuth Clients (official docs, published 2026-01-05) -- OAuth setup, scopes, token lifecycle
- Tailscale Subnet Routers (official docs, validated 2026-02) -- SNAT behavior, IP forwarding, subnet advertisement
- Tailscale High Availability Setup (official docs, validated Oct 2025) -- `--accept-routes` warning, failover patterns
- Tailscale Overlapping Subnet Route Failover (official docs, validated Mar 2026) -- route black hole behavior
- Tailscale Webhooks (official docs) -- event subscription, HMAC signature verification
- Tailscale API Reference -- endpoint list, authentication, rate limits
- Tailscale Ephemeral Nodes (official docs, validated Dec 2025) -- auth key lifecycle
- Tailscale Firewall Ports (official docs, validated Feb 2026) -- direct connection requirements
- Xray Routing Documentation (official Project X docs) -- routing rule format, geoip module
- XTLS/Xray-examples GitHub (official) -- example chain configurations
- MHSanaei/3x-ui GitHub (official repository) -- 3x-ui API reference
- Existing codebase analysis (prisma/schema.prisma, src/lib/*.ts) -- current implementation patterns
- PROJECT.md key decisions -- Tailscale transport, central push, hybrid model

### Secondary (MEDIUM confidence)
- DrayTek Central VPN Management (CVM) -- reference pattern for central push model
- MaxMind GeoIP2 Lite (official docs) -- free tier terms, MMDB format
- 3x-ui Postman API Collection -- community-maintained API reference
- WireGuard Access Control with iptables (Pro Custodibus) -- MSS clamping, per-peer routing
- Tailscale API Key vs OAuth comparison -- authentication strategy

### Tertiary (LOW confidence)
- GL.iNet VPN Chaining Forum -- community discussion, pattern reference
- WireGuard over Xray VLESS (blog post) -- advanced pattern reference
- Three-Layer Tunnel Guide (blog post) -- advanced chaining pattern
- VPN Chaining with WireGuard (Medium) -- chain topology patterns
- WireGuard Asymmetric Routing (Reddit) -- asymmetric routing pitfalls

---
*Research completed: 2026-04-29*
*Ready for roadmap: yes*
