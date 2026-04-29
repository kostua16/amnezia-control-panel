# Feature Landscape: v1.1 Multi-Panel Chain Routing

**Domain:** Web-based VPN admin control panel -- multi-panel chain routing extension
**Researched:** 2026-04-29
**Scope:** NEW features for v1.1 only (existing v1.0 features already shipped)

## Table Stakes

Features expected for a multi-panel VPN chain routing system. Missing = v1.1 feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Remote panel registration | Admin must be able to add remote panel instances to the central panel | Medium | Central panel needs to know about remote panels: URL, auth credentials, status. Pattern: DrayTek CVM branch registration model. |
| Connection status for remote panels | Real-time visibility of whether remote panels are reachable | Low | Extends existing `server-connection.ts` ping stub to use Tailscale IPs instead of raw SSH. WebSocket heartbeat per panel. |
| Chain config push from central to remote | Core value: central admin defines chain once, pushes to all remote panels | High | Central generates full chain config, pushes via API to each remote panel. Remote applies to local AWG/3x-ui. Requires conflict detection (what if local admin changed something). |
| Apply chain configuration to servers | Chain config must actually reach VPN services (AWG, 3x-ui) on remote servers | High | Extends existing `applyChainConfig` stub to make real API calls. 3x-ui has REST API (documented in Postman collection); AWG requires shell commands via Tailscale SSH. |
| Rollback of pushed configuration | If push breaks a remote panel, admin needs to undo | Medium | Store previous config version before applying. One-click rollback. Critical for trust in central push model. |
| Push status and error reporting | Central panel must know if a push succeeded or failed on each remote | Low | Per-node push result (success/failed/pending). Existing `applyChainConfig` returns `{success, appliedTo, errors}` -- extend for multi-panel. |

## Differentiators

Features that set this apart from simple multi-server setups. Valuable but not expected by default.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid autonomy model | Remote panels work independently when central is unreachable | High | Each remote panel caches its last-known-good config. When central disconnects, remote continues operating on cached config. Sync resumes when connection restores. Major differentiator vs pure central-only models. |
| Visual multi-panel chain map | See the full chain topology across all panels in one view | Medium | Extends existing `chain-visualization.tsx` to show panel boundaries. Each node tagged with which panel owns it. Connection lines show Tailscale transport links. |
| Geo-routing across chained servers | Route traffic based on destination country through specific chain hops | High | Extends existing `geo-routing.ts` (currently in-memory with stub GeoIP lookup). Add MaxMind GeoIP2 Lite MMDB for real IP-to-country resolution. Route decisions trigger chain selection. |
| Tailscale subnet router as transport | Zero-config encrypted mesh between panels without manual port forwarding | Medium | Each server runs Tailscale as a subnet router advertising its VPN subnet. Other panels reach it via Tailscale IPs. No public port exposure needed. |
| Pre-configuration templates for chain setup | One-click chain setup from presets (e.g., "split routing Russia/NL", "3-hop privacy") | Medium | Extends existing `chain-templates.ts` (4 built-in templates: 2-hop, 3-hop, split, mesh). Add server preset templates (VPS provider configs, OS-specific settings) and routing presets (geo rules bundles). |
| Central health dashboard for all panels | Aggregate health view: services, traffic, alerts across all remote panels | Medium | Existing dashboard shows one server. Aggregate metrics from all remote panels via periodic polling + WebSocket. |
| Config diff preview before push | Show admin exactly what will change on remote panel before applying | Low | Compare local config with remote config, display diff. Prevents accidental overwrites. |

## Anti-Features

Features to explicitly NOT build in v1.1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time config sync (bidirectional) | Adds enormous complexity -- conflict resolution, merge conflicts, race conditions. Overkill for single admin at 1-3 servers | Unidirectional push from central. Remote panels are consumers, not editors of chain config. Local-only settings stay local. |
| Automatic failover between panels | Requires health monitoring, consensus protocol, split-brain handling. Not needed at 1-3 server scale | Manual failover: admin clicks to switch chain path. Health alerts notify admin of issues. |
| Tailscale as VPN for end users | Tailscale is transport between panels only. End users connect via AWG/3x-ui as before | Keep Tailscale as infrastructure layer only. User-facing VPN remains AWG (WireGuard) and 3x-ui (Xray). |
| Config version history / audit log | Adds storage complexity. Not needed at single-admin scale | Simple last-known-good snapshot for rollback. No full version history. |
| Remote panel auto-discovery | Zero-config discovery is a security risk and adds mDNS/DNS-SD complexity | Manual registration with Tailscale IP and auth credentials. Admin explicitly adds each remote panel. |
| Multi-admin / RBAC across panels | Out of scope (already excluded in v1.0). Single admin only | Single admin authenticates to central, central authenticates to remotes via stored API keys. |

## Feature Dependencies

```
Tailscale subnet router setup
    --> Remote panel registration (needs Tailscale IP to reach remote)
        --> Chain config push (needs registered remote panels)
            --> Apply chain config to remote servers (needs working push channel)
                --> Rollback (needs applied config to be revertible)

Geo-routing across chained servers
    --> GeoIP database integration (MaxMind MMDB)
    --> Chain templates with geo-aware presets
    --> Config push to apply geo rules to remote panels

Pre-configuration templates
    --> Server preset templates (OS/provider defaults)
    --> Routing preset templates (geo rule bundles)
    --> Chain preset templates (already exists, extend)
    --> Template application during panel registration

Hybrid autonomy model
    --> Remote panel local config cache
    --> Heartbeat / connection status between central and remote
    --> Config diff + conflict detection on push
```

## Detailed Feature Breakdown

### 1. Multi-Panel Chain Registration and Management

**Expected behavior:**
- Admin opens "Remote Panels" section in central panel
- Adds a remote panel by entering: Tailscale hostname, panel API URL, admin credentials (username/password for remote panel)
- Central validates connectivity (ping + API auth test)
- Remote panel appears in list with status: connected/offline/error
- Admin can edit credentials, remove panel, test connection
- Each remote panel shows: name, Tailscale IP, local server count, last sync timestamp

**Implementation approach:**
- New Prisma model `RemotePanel` with fields: id, name, tailscaleIp, panelUrl, authCredentialHash, status, lastSyncAt
- New API routes: POST/GET/PUT/DELETE `/api/remote-panels`
- Extend existing `server-connection.ts` to support Tailscale-based connectivity testing
- Store remote panel API credentials encrypted (AES-256-GCM with server-side key)

**Depends on:** Tailscale subnet router operational on all servers

### 2. Central Push of Chain Configuration to Remote Panels

**Expected behavior:**
- Admin builds a chain in the visual chain builder (existing v1.0 feature)
- Admin selects "Push to Remote Panels" button
- Central generates chain config for each remote panel's role in the chain
- Pushes relevant config portions to each remote panel via API call
- Each remote panel receives: its WireGuard peers, its Xray routing rules, its chain role
- Central displays push results: success/failed per panel with error details
- Remote panel applies config to its local AWG/3x-ui services

**Implementation approach:**
- New API route: POST `/api/chains/:id/push` -- orchestrates push to all remote panels
- New service `chain-push.ts` that: (1) generates per-panel config, (2) calls remote panel API, (3) collects results
- Remote panel needs new API endpoints: POST `/api/chain/receive-config` (accepts pushed config)
- Use the existing `generateChainConfig` function from `chain-router.ts`
- Conflict detection: compare pushed config hash with remote's current config hash

**Depends on:** Remote panel registration, remote panel API endpoints for config receipt

### 3. Geo-Routing Across Chained Servers

**Expected behavior:**
- Admin defines geo-routing rules: "Traffic to RU goes direct, traffic to US goes through VPN chain A"
- Rules reference chain IDs and can be prioritized
- GeoIP lookup resolves destination IP to country code
- Traffic is routed according to the highest-priority matching rule
- Rule types: country code (US, DE, RU), region (Europe, Asia-Pacific), special (domestic/foreign)

**Current state:** v1.0 has `geo-routing.ts` with rule evaluation engine but:
- GeoIP lookup is a STUB (returns null for all IPs)
- Rules stored in-memory only (no persistence)
- No integration with actual traffic routing

**Implementation approach:**
- Integrate MaxMind GeoIP2 Lite MMDB database (free, updated weekly)
- New lib `geoip-lookup.ts` using `@maxmind/mmdb-reader` or `mmdb-lib`
- Persist geo-routing rules in Prisma (new model `GeoRoutingRule`)
- Generate Xray geoip routing rules from geo-routing config
- Push geo-routing rules to remote panels alongside chain config
- Weekly MMDB auto-update via cron job or API endpoint

**Depends on:** MaxMind GeoIP2 Lite account (free registration), chain config push

### 4. Tailscale Subnet Router Integration

**Expected behavior:**
- Each VPN server runs Tailscale as a subnet router
- Tailscale advertises the server's VPN subnet (e.g., 10.0.1.0/24) to the tailnet
- Other panels/servers reach this subnet via Tailscale's encrypted mesh
- Central panel can see all Tailscale nodes and their advertised routes
- Admin can manage Tailscale auth keys and node tags from the central panel

**Tailscale setup per server (documented, not built into panel):**
1. Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`
2. Enable IP forwarding: `sysctl -w net.ipv4.ip_forward=1`
3. Start as subnet router: `tailscale up --advertise-routes=10.0.1.0/24 --authkey=tskey-xxx`
4. Approve routes in Tailscale admin console (or use `autoApprovers` in ACL policy)

**Panel integration approach:**
- New Tailscale service client `lib/tailscale-client.ts` wrapping Tailscale API v2
- Key API endpoints used:
  - `GET /api/v2/tailnet/{tailnet}/nodes` -- list all nodes in tailnet
  - `POST /api/v2/tailnet/{tailnet}/nodes/{nodeId}/routes` -- enable subnet routes
  - `POST /api/v2/tailnet/{tailnet}/keys` -- create auth keys for new server provisioning
  - `GET /api/v2/tailnet/{tailnet}/acl` -- read ACL policies
- New API routes in panel: GET `/api/tailscale/nodes`, GET `/api/tailscale/routes`
- Store Tailscale API key as environment variable `TAILSCALE_API_KEY`
- Display Tailscale node status alongside server status in dashboard
- Use Tailscale IPs as the primary transport address for remote panel communication

**Depends on:** Tailscale account, Tailscale installed on all servers, API key generated

### 5. Pre-Configuration Templates

**Expected behavior:**

**5a. VPN Protocol Templates (extend existing):**
- v1.0 already has 7 protocol templates in `protocol-templates.ts` (Standard WireGuard, AmneziaWG, VLESS-XTLS-Vision, VLESS-WS-CDN, VMess-WS, Trojan-TCP, Shadowsocks-2022)
- v1.1 adds: VLESS-REALITY, VLESS-GRPC, Hysteria2, TUIC
- Each template includes recommended settings for the protocol's use case

**5b. Server Presets:**
- Pre-configured settings for common VPS providers (Hetzner, DigitalOcean, Linode, Contabo)
- OS-specific defaults (Ubuntu 22.04/24.04, Debian 12)
- Include: recommended kernel parameters, firewall rules, DNS settings
- Applied during initial server setup / panel registration

**5c. Routing Presets:**
- Bundle of geo-routing rules as a named preset
- Examples: "Russia Direct" (RU traffic direct, everything else via VPN), "EU Privacy" (EU traffic direct, US/Asia via chain), "Full Tunnel" (everything via VPN)
- Admin selects preset, system generates individual geo-routing rules
- Extend existing `config-presets.ts` pattern (5 presets for VPN protocols) to routing

**5d. Chain Presets (extend existing):**
- v1.0 already has 4 chain templates: 2-hop, 3-hop, split routing, mesh
- v1.1 adds presets that combine chain template + protocol choices + routing rules
- Example: "Privacy Chain NL-FI-JP" = 3-hop chain + VLESS-REALITY on each hop + specific routing rules
- One-click setup: admin selects preset, maps servers to chain nodes, applies

**Implementation approach:**
- New Prisma model `RoutingPreset` for routing rule bundles
- Extend `chain-templates.ts` with richer preset definitions
- New `server-presets.ts` for VPS/OS defaults
- New API routes for CRUD on each template type
- Template export/import (already partially built in v1.0)

**Depends on:** Geo-routing rules persistence, chain config push

## MVP Recommendation for v1.1

**Phase 1 -- Foundation (Tailscale + Remote Panels):**
1. Tailscale subnet router setup guide (documentation, not code)
2. Remote panel registration (Prisma model + API routes + UI)
3. Connection status monitoring for remote panels

**Phase 2 -- Chain Push:**
4. Chain config generation per remote panel role
5. Push mechanism (central -> remote API)
6. Push status reporting and error handling
7. Basic rollback (last-known-good config)

**Phase 3 -- Geo-Routing:**
8. MaxMind GeoIP2 Lite integration
9. Geo-routing rules persistence (Prisma)
10. Geo-aware chain routing (route selection based on destination country)

**Phase 4 -- Templates:**
11. Server presets (VPS provider defaults)
12. Routing presets (geo rule bundles)
13. Extended chain presets (chain + protocol + routing combos)

**Defer to v1.2:**
- Bidirectional config sync (too complex for single admin)
- Automatic failover (not needed at this scale)
- Config version history / audit log
- Advanced Tailscale management (ACL editing, DNS config from panel)

## Complexity Assessment

| Feature Area | Complexity | Primary Risk |
|-------------|-----------|--------------|
| Remote panel registration | Medium | Credential storage security, Tailscale connectivity |
| Chain config push | High | Partial push failures, conflict detection, rollback correctness |
| Geo-routing across chains | High | GeoIP database accuracy, performance of per-packet lookups, rule priority edge cases |
| Tailscale integration | Medium | API rate limits, key management, auth key provisioning workflow |
| Pre-config templates | Low-Medium | Template maintenance, keeping presets current with protocol changes |

## Sources

- [Tailscale Subnet Routers Documentation](https://tailscale.com/docs/features/subnet-routers) -- HIGH confidence (official docs, validated 2026-01-12)
- [Tailscale ACLs Documentation](https://tailscale.com/docs/features/access-control/acls) -- HIGH confidence (official docs, validated 2026-01-05)
- [Tailscale API v2](https://tailscale.com/api) -- MEDIUM confidence (landing page verified; specific endpoints from training data, need API-docs validation)
- [3x-ui Postman API Collection](https://www.postman.com/hsanaei/3x-ui/documentation/q1l5l0u/3x-ui) -- MEDIUM confidence (community-maintained Postman collection)
- [MHSanaei/3x-ui GitHub](https://github.com/MHSanaei/3x-ui) -- HIGH confidence (official repository)
- [Xray Routing Documentation](https://xtls.github.io/en/config/routing.html) -- HIGH confidence (official Project X docs)
- [XTLS/Xray-examples GitHub](https://github.com/XTLS/Xray-examples) -- HIGH confidence (official example configs)
- [DrayTek Central VPN Management (CVM)](https://www.draytek.com/support/knowledge-base/5783) -- MEDIUM confidence (vendor documentation, validated as reference pattern for central push model)
- [GL.iNet VPN Chaining Forum](https://forum.gl-inet.com/t/chain-together-multiple-vpn-clients/64220) -- LOW confidence (community discussion, pattern reference only)
- [MaxMind GeoIP2 Lite](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data) -- MEDIUM confidence (official docs, need to verify current free tier terms)
- [WireGuard over Xray VLESS](https://btwiusearch.net/posts/wg-xray/) -- LOW confidence (blog post, pattern reference only)
- [Three-Layer Tunnel Guide](https://01.me/en/2025/03/layer-3-tunnel/) -- LOW confidence (blog post, advanced pattern reference)

## Existing Codebase Assets for v1.1

| Asset | Location | Reuse for v1.1 |
|-------|----------|-----------------|
| Chain templates | `src/lib/chain-templates.ts` | Extend with richer presets, add geo-aware templates |
| Chain router | `src/lib/chain-router.ts` | Extend `applyChainConfig` from stub to real push |
| Chain config generator | `src/lib/chain-router.ts::generateChainConfig` | Core of push mechanism, generates per-node configs |
| Geo-routing engine | `src/lib/geo-routing.ts` | Replace stub GeoIP lookup with MaxMind, persist rules |
| Server connection | `src/lib/server-connection.ts` | Extend for Tailscale-based connections to remote panels |
| Config templates | `src/lib/config-templates.ts` | Already has Prisma CRUD, extend for new template types |
| Protocol templates | `src/lib/protocol-templates.ts` | Add new protocols (VLESS-REALITY, Hysteria2, TUIC) |
| Config presets | `src/lib/config-presets.ts` | Extend pattern for routing presets and server presets |
| VPN services | `src/lib/vpn-services.ts` | Wire real CLI commands (currently stubs) |
| Prisma schema | `prisma/schema.prisma` | Add RemotePanel, GeoRoutingRule, RoutingPreset models |
