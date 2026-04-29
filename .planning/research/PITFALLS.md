# Domain Pitfalls

**Domain:** VPN Management Control Panel -- v1.1 Multi-Panel Chain Routing
**Researched:** 2026-04-29
**Scope:** Pitfalls specific to ADDING multi-panel communication, Tailscale integration, chain routing engine, and template systems to the existing v1.0 panel.

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or complete feature failure.

### Pitfall 1: Tailscale SNAT Hiding Source IPs in VPN Chains

**What goes wrong:** When using Tailscale subnet routers to connect panels in a chain, the default SNAT (Source Network Address Translation) rewrites source IPs so all traffic appears to come from the Tailscale subnet router, not the original panel. This breaks geo-routing decisions that depend on seeing real client IPs, and it breaks return-path routing when chaining VPN tunnels.

**Why it happens:** Tailscale subnet routers use SNAT by default (`--snat-subnet-routes=true`). When Panel A sends traffic through a Tailscale subnet router to Panel B, Panel B sees the Tailscale IP of the subnet router (100.x.x.x range) as the source, not Panel A's real VPN client IP. Geo-routing rules that inspect source IPs will misclassify traffic.

**Consequences:**
- Geo-routing sends domestic traffic through foreign chains because the source IP appears to be the Tailscale router's location
- Return-path routing fails in multi-hop chains: response packets go to the wrong node
- Asymmetric routing causes connection timeouts and dropped packets
- Debugging becomes extremely difficult because packet traces show unexpected source/destination pairs

**Prevention:**
- Use `--snat-subnet-routes=false` when configuring Tailscale subnet routers for inter-panel communication, so original IPs are preserved
- When disabling SNAT, you MUST add a return route on every panel: route `100.64.0.0/10` (Tailscale IP range) back through the subnet router's LAN IP
- Add the return route via: DHCP option 121, static routes on each device, or VPC routing table entries
- Design the chain routing engine to be aware of SNAT state: if SNAT is enabled, the engine must adjust geo-routing to use the subnet router's geo-location, not the client's
- Validate end-to-end IP visibility in integration tests before going live

**Detection:**
- `tcpdump` on intermediate panels showing unexpected source IPs
- Geo-routing rules misclassifying traffic (check geo-routing logs)
- Connections that work in one direction but time out in the other

**Phase Addressed:** Tailscale Integration (v1.1 Phase 1)

**Confidence:** HIGH -- confirmed by official Tailscale documentation (https://tailscale.com/kb/1019/subnets/)

---

### Pitfall 2: Central Push Creates Split-Brain During Partial Apply

**What goes wrong:** The central panel pushes a chain configuration to 3 remote panels. Panel A and B apply successfully, but Panel C is offline or rejects the config. The chain is now in an inconsistent state: A and B route traffic through a chain that C doesn't know about, causing traffic to arrive at C but get dropped or misrouted.

**Why it happens:** The existing `applyChainConfig()` in `chain-router.ts` is a simple loop with error collection -- it does NOT implement atomic multi-node apply. There is no transaction boundary across remote panels. If any node in the chain fails, the already-applied nodes remain configured, creating a split-brain topology.

**Consequences:**
- Traffic enters the chain at Panel A, passes through Panel B, but gets dropped at Panel C
- Routing loops if panels have fallback rules that redirect to already-applied chain paths
- Impossible to rollback partially applied configurations without manual intervention
- Users experience intermittent connectivity depending on which path their traffic takes

**Prevention:**
- Implement a two-phase commit protocol for chain configuration push:
  - Phase 1 (Prepare): Send config to all panels, wait for acknowledgment. Each panel validates the config but does NOT apply it
  - Phase 2 (Commit): Only after ALL panels acknowledge, send the commit signal. If any panel fails Phase 1, send abort to all
- Maintain a "config version" counter on each panel. Push must include expected version; panels reject if their version doesn't match
- Implement rollback: store the previous config on each panel before applying new one. On abort, restore previous config
- Add a "config drift" detector: central panel periodically compares expected vs actual config version on each remote panel
- If rollback fails, mark the chain as "degraded" and alert the admin -- never leave the system in an unknown state

**Detection:**
- Config version mismatches between central and remote panels
- Remote panel health checks failing after a push operation
- Traffic flow monitoring showing packets arriving at a panel that doesn't have the expected chain config
- Alert system detecting config drift

**Phase Addressed:** Multi-Panel Communication & Sync (v1.1 Phase 2)

**Confidence:** HIGH -- standard distributed systems pitfall, corroborated by Tailscale HA failover documentation

---

### Pitfall 3: VPN Chain MTU Collapse from Double Encapsulation

**What goes wrong:** When chaining VPNs (AmneziaWG tunnel + Tailscale transport), packets are encapsulated twice. Each encapsulation layer adds overhead (~80 bytes per WireGuard layer). The effective MTU drops from 1500 to ~1340 or lower. Without proper MSS clamping, TCP connections hang or fail silently, while UDP traffic gets fragmented and dropped by middleboxes.

**Why it happens:** The existing chain system generates WireGuard peer configs with default `AllowedIPs` but does NOT set MTU or MSS clamping parameters. Tailscale itself uses WireGuard internally, so chaining adds: outer WireGuard (Tailscale) + inner WireGuard (AmneziaWG) = ~160 bytes of overhead minimum. The ICMP "Fragmentation Needed" messages required for Path MTU Discovery are frequently blocked by firewalls, making PMTU discovery unreliable.

**Consequences:**
- HTTPS connections to websites behind the chain hang indefinitely (TCP handshake completes, then data transfer stalls)
- DNS queries over UDP get fragmented and silently dropped
- Video streaming, large file transfers, and any bulk data transfer fail or are extremely slow
- The problem is intermittent -- works for small packets, fails for large ones -- making it very hard to diagnose
- Users blame the VPN, not the MTU issue

**Prevention:**
- Calculate and set explicit MTU on each tunnel interface: `MTU = 1500 - (number_of_encapsulation_layers * 80)`
- Apply MSS clamping at EVERY tunnel entry point using iptables: `iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu`
- Never block ICMP Type 3 Code 4 (Fragmentation Needed) -- add explicit firewall allow rules
- Set conservative default MTU (1280, IPv6 minimum) as the innermost tunnel MTU
- Document the MTU calculation in the chain template so operators can verify
- Add MTU validation to the chain apply step: verify `ping -M do -s <calculated_size>` works end-to-end before marking chain as active
- Include MTU settings in the chain template schema as a required field, not optional

**Detection:**
- `ping -M do -s 1400 <remote_host>` fails while `ping -M do -s 500 <remote_host>` succeeds
- TCP connections that start but then stall (especially HTTPS)
- `tcpdump` showing retransmissions or large packets being sent but no response
- Monitoring showing high retransmission rates on tunnel interfaces

**Phase Addressed:** Chain Routing Engine (v1.1 Phase 3)

**Confidence:** HIGH -- well-documented WireGuard networking issue, confirmed by multiple sources

---

### Pitfall 4: Overlapping Subnet Routes Between Panels Create Routing Black Holes

**What goes wrong:** Multiple panels advertise overlapping subnet routes through Tailscale (e.g., Panel A advertises `10.0.0.0/16` and Panel B advertises `10.0.0.0/24`). When the more-specific router (Panel B) goes offline, Tailscale does NOT fall back to the broader route. Traffic to `10.0.0.0/24` is silently dropped.

**Why it happens:** Tailscale evaluates each advertised prefix independently and does NOT cross prefix boundaries for failover. This is an intentional security design: Tailscale cannot know if a broader route leads to the same destination or a different, unauthorized one. Confirmed by official Tailscale documentation (https://tailscale.com/docs/reference/troubleshooting/network-configuration/overlapping-subnet-route-failover, validated March 2026).

**Consequences:**
- One panel going offline causes traffic to specific subnets to be permanently black-holed
- Failover does NOT work across prefix boundaries -- the broader route is never used as fallback
- Admin assumes HA is working because "both panels advertise routes" -- but it's not
- Debugging is confusing because Tailscale shows the broader route as "active" but traffic still gets dropped

**Prevention:**
- Design the subnet allocation scheme so each panel advertises NON-overlapping subnets
- If overlapping is unavoidable, ensure ALL routers advertising a broader prefix also advertise the more-specific prefix (e.g., both Panel A and B advertise `10.0.0.0/24`)
- Add a subnet conflict detector to the central panel's chain configuration push: reject configs that would create overlapping advertisements across panels
- Document the Tailscale failover behavior clearly in the admin UI: show which panels are failover candidates for each route
- Never rely on "broader route will catch it" as a fallback strategy -- it won't
- Use Tailscale's recommended HA pattern: multiple routers advertising the EXACT SAME prefix for true failover

**Detection:**
- Central panel periodically queries Tailscale API for advertised routes on each node, compares against expected config
- Traffic monitoring showing drops to specific subnets after a panel goes offline
- Tailscale admin console showing route advertisements that don't match the expected config

**Phase Addressed:** Tailscale Integration (v1.1 Phase 1)

**Confidence:** HIGH -- confirmed by official Tailscale troubleshooting docs (validated March 2026)

---

### Pitfall 5: `--accept-routes` on HA Subnet Routers Creates Routing Loops

**What goes wrong:** When setting up multiple subnet routers for high availability, if `--accept-routes` is enabled alongside `--advertise-routes`, the standby router accepts its own advertised routes from the primary router. Traffic for the directly-connected subnet gets sent through the primary router instead of being handled locally, creating inefficient routing and potential loops.

**Why it happens:** With `--accept-routes` enabled, each subnet router learns about routes advertised by other routers (including the primary for the same subnet). The standby router then routes traffic destined for its own local subnet through the primary, because it learned about the route from the primary. Confirmed by official Tailscale HA documentation (https://tailscale.com/docs/how-to/set-up-high-availability, validated October 2025).

**Consequences:**
- Traffic takes a longer path than necessary, adding latency
- In worst case, creates routing loops where traffic bounces between routers
- Bandwidth is consumed unnecessarily on inter-router links
- Debugging is confusing because traffic appears to work but with inexplicably high latency

**Prevention:**
- For HA subnet router setups, use `--advertise-routes` ONLY. Do NOT use `--accept-routes` unless you specifically need it
- If `--accept-routes` is required, add route filtering to prevent accepting routes for subnets the router is directly connected to
- Include this as a validation check in the Tailscale setup automation: warn or reject if both flags are set together
- Document this explicitly in the admin panel's Tailscale configuration section

**Detection:**
- `traceroute` showing traffic going through an extra hop for locally-connected subnets
- Higher-than-expected latency between panels
- Tailscale status showing "relay" connections instead of "direct" between HA pairs

**Phase Addressed:** Tailscale Integration (v1.1 Phase 1)

**Confidence:** HIGH -- confirmed by official Tailscale HA documentation (validated October 2025)

---

## Moderate Pitfalls

Mistakes that cause significant degradation but don't require a rewrite.

### Pitfall 6: GeoIP Database Staleness Causes Misrouting

**What goes wrong:** Geo-routing decisions rely on IP-to-country lookups, but the GeoIP database is stale. IP ranges have been reassigned between countries, so traffic gets routed through the wrong chain (domestic traffic sent through foreign servers or vice versa).

**Why it happens:** The existing `lookupGeoIP()` in `geo-routing.ts` is a stub that returns null for all lookups. The production implementation will need a GeoIP database (MaxMind GeoLite2 or similar). These databases are updated weekly, but if the auto-update mechanism fails silently, the database becomes stale within weeks. MaxMind's own data shows ~75-85% accuracy at city level, and IP reallocation by Regional Internet Registries can change geo-assignments within days.

**Consequences:**
- Domestic traffic (e.g., Russian websites) routed through foreign VPN servers, adding latency and potentially triggering blocks
- Foreign traffic routed through domestic servers, potentially causing access issues
- Compliance violations if traffic is supposed to stay within a jurisdiction
- Users notice inconsistent behavior: same website works one day, doesn't the next

**Prevention:**
- Implement a weekly GeoIP database auto-update with checksum verification
- Monitor the database file's modification date and trigger alerts if older than 14 days
- Consider using MaxMind's GeoIP2 Precision web API for real-time lookups on uncertain IPs (fallback, not primary)
- Add a manual "refresh database" button in the admin panel
- Log geo-routing decisions with the geo-data version/timestamp for auditability
- Implement a "geo-confidence" indicator: if the database is >7 days old, flag geo-routing results as lower confidence in the UI
- Consider cross-referencing with a second GeoIP provider for high-stakes routing decisions

**Detection:**
- Admin dashboard showing "GeoIP database last updated: X days ago" with warning colors
- User reports of routing anomalies
- Automated weekly test: query known IPs for specific countries, verify results match expectations

**Phase Addressed:** Geo-Routing Across Chained Servers (v1.1 Phase 3)

**Confidence:** MEDIUM -- general GeoIP knowledge, but specific stale-data impact on this project's scale is estimated

---

### Pitfall 7: Template Variable Injection Produces Invalid VPN Configs

**What goes wrong:** Template variables for VPN configurations are not properly validated or escaped. A server hostname containing special characters, or a port number set to 0, produces a WireGuard config file that AmneziaWG rejects or interprets incorrectly. The chain apply "succeeds" but the VPN service fails to start.

**Why it happens:** The existing template system in `config-templates.ts` stores template content as `Json` in SQLite with no schema validation. Templates are rendered by substituting variables into config text, but there is no validation of the rendered output against the target config format (WireGuard INI, Xray JSON, etc.). A template might produce syntactically valid text but semantically invalid VPN configuration.

**Consequences:**
- VPN service fails to start after applying a template-generated config, breaking connectivity
- Error messages from AmneziaWG or Xray are cryptic and don't point to the template variable that caused the issue
- Admin wastes time debugging the generated config instead of the template
- Rolling back to a working config requires manual intervention

**Prevention:**
- Implement a two-stage pipeline: Template Render -> Schema Validation -> Apply
- For WireGuard configs: validate the rendered INI against a strict schema (required sections: [Interface], [Peer]; required fields per section; valid IP/CIDR format for Address, AllowedIPs)
- For Xray configs: validate rendered JSON against Xray's configuration schema
- Add template-specific validation rules: port must be 1-65535, hostname must be valid FQDN or IP, private keys must match WireGuard key format (base64, 44 chars)
- Implement a "dry-run" mode that renders and validates without applying
- Store the rendered config alongside the template for audit and rollback
- Add unit tests for each built-in template with various edge-case inputs

**Detection:**
- Service health check failing after a template-based config apply
- Config validation errors logged during the apply step
- Admin dashboard showing config apply failures with specific validation error messages

**Phase Addressed:** Pre-configuration Templates (v1.1 Phase 4)

**Confidence:** MEDIUM -- general software engineering pattern, not specific to this codebase

---

### Pitfall 8: Remote Panel API Authentication Without Mutual TLS or Token Rotation

**What goes wrong:** The central panel authenticates to remote panels using API keys stored in the database. These keys never rotate, are transmitted over the network, and if any remote panel is compromised, the attacker gains access to the central panel's push API.

**Why it happens:** The existing `Server` model stores `apiKeyHash` for server authentication, but the v1.1 multi-panel system needs inter-panel API calls. If these use the same static API key mechanism without rotation, the attack surface expands: compromising any single panel gives access to the central panel's management API.

**Consequences:**
- Single panel compromise escalates to full system compromise
- API keys in transit can be intercepted (if not using Tailscale's encrypted transport for all inter-panel traffic)
- No ability to revoke a single panel's access without breaking the entire chain

**Prevention:**
- Use Tailscale as the exclusive transport for all inter-panel API calls -- Tailscale provides end-to-end WireGuard encryption, so API calls never traverse the public internet
- If Tailscale is the transport, API keys are secondary defense: use short-lived JWT tokens issued by the central panel, with automatic rotation
- Implement token scope: each remote panel's token should only allow it to receive chain configs and report status, not modify central panel settings
- Add token revocation capability: central panel can invalidate a remote panel's token and force re-authentication
- Log all inter-panel API calls for audit
- If Tailscale transport is unavailable (fallback scenario), require mutual TLS for direct API calls

**Detection:**
- Audit logs showing API calls from unexpected Tailscale IPs
- Failed authentication attempts from unknown sources
- Token age monitoring: alert if any token is older than the rotation period

**Phase Addressed:** Multi-Panel Communication & Sync (v1.1 Phase 2)

**Confidence:** MEDIUM -- security best practice, specific threat model depends on deployment

---

### Pitfall 9: In-Memory Geo-Routing State Lost on Panel Restart

**What goes wrong:** The existing v1.0 geo-routing and whitelist data is stored in-memory (noted as tech debt in PROJECT.md). When a remote panel restarts, its geo-routing rules are lost. The central panel doesn't know the remote lost its rules, and traffic gets misrouted until the next config push.

**Why it happens:** The v1.0 design explicitly chose in-memory stores for geo-routing/whitelist to simplify the MVP. In v1.1 with multiple panels, each panel needs its own copy of the geo-routing rules. If these are only in memory, a restart on any panel wipes them. The central panel may not detect this because the push was "successful" (the rules were received and stored in memory).

**Consequences:**
- Panel restart causes geo-routing to silently revert to default (allow-all or block-all depending on implementation)
- Traffic misrouting persists until admin notices or next config push
- Inconsistent behavior across panels: some have geo-routing rules, others don't

**Prevention:**
- Persist geo-routing rules to SQLite on each panel as part of v1.1 -- this is the tech debt payoff
- Include a "config checksum" in the central panel's status check: verify each remote panel's active config matches what was pushed
- On panel startup, load persisted geo-routing rules from DB before accepting traffic
- If no persisted rules exist on startup, enter a "safe default" mode (block all or route through central) rather than allow-all
- Add a startup self-check: compare local config version against central panel's expected version, request re-sync if mismatched

**Detection:**
- Config version mismatch alerts between central and remote panels
- Geo-routing logs showing "no rules loaded" on panel startup
- Admin dashboard showing "config drift" warnings

**Phase Addressed:** Multi-Panel Communication & Sync (v1.1 Phase 2)

**Confidence:** HIGH -- existing tech debt explicitly documented in PROJECT.md

---

## Minor Pitfalls

Mistakes that cause inconvenience but are quickly fixable.

### Pitfall 10: Tailscale Auth Key Expiry Breaks Panel Registration

**What goes wrong:** Remote panels are registered with the central panel using Tailscale auth keys. These keys have an expiry (default 90 days). When a key expires, the remote panel drops off the tailnet and becomes unreachable. The central panel shows the remote as "offline" but doesn't explain why.

**Why it happens:** Tailscale auth keys have configurable expiry. If the admin doesn't set up key rotation or disable key expiry for tagged devices, keys expire silently. The Tailscale node disconnects and must be re-authenticated. Confirmed by Tailscale documentation: ephemeral nodes auto-remove after inactivity, and tagged devices can have key expiry disabled.

**Prevention:**
- Use Tailscale tags (`tag:vpn-panel`) for panel devices and disable key expiry for tagged devices
- Implement a key rotation mechanism in the central panel: generate new auth keys before old ones expire
- Monitor Tailscale device key expiry dates via the API (`GET /api/v2/tailnet/{tailnet}/devices`) and alert the admin 30 days before expiry
- Add a "re-authenticate" button in the admin UI for panels that have lost connectivity
- Document the key lifecycle in the admin panel's Tailscale settings section

**Detection:**
- Tailscale API returning 401 for expired keys
- Device list showing key expiry dates approaching
- Panel connectivity alerts

**Phase Addressed:** Tailscale Integration (v1.1 Phase 1)

**Confidence:** HIGH -- confirmed by official Tailscale documentation

---

### Pitfall 11: Chain Template Assumes Static Server Roles But Servers Change

**What goes wrong:** A chain template assigns servers to fixed roles (entry, middle, exit). After initial setup, an admin changes a server's location or capabilities. The chain config still references the old topology, but the server is no longer appropriate for its role (e.g., the "exit" server was moved from Netherlands to a domestic location).

**Why it happens:** The existing `chain-templates.ts` creates static node-to-server mappings at apply time. There is no mechanism to re-evaluate whether the mapping is still valid after server properties change. The chain config is a point-in-time snapshot, not a living configuration.

**Consequences:**
- Traffic exits through a server in the wrong geographic location
- Performance degrades because the chain topology no longer matches the network topology
- Admin must manually rebuild the chain when servers change

**Prevention:**
- Add a "chain health check" that periodically verifies: (a) all servers in the chain are online, (b) server geo-locations match chain expectations
- Implement "config drift detection": compare server metadata at apply time vs. current metadata
- Add an admin alert when a chain's server properties change after initial configuration
- Consider making chain configs reference servers by role/geo-tag rather than by specific server ID, so the chain can adapt when servers change
- Store the expected server properties (location, protocol) alongside the chain config for comparison

**Detection:**
- Chain health check comparing current server properties against chain config expectations
- Admin alerts when server properties change for servers that are part of active chains

**Phase Addressed:** Pre-configuration Templates (v1.1 Phase 4)

**Confidence:** MEDIUM -- architectural concern, not yet implemented

---

### Pitfall 12: Tailscale DERP Relay Adds Latency to Chain Traffic

**What goes wrong:** When two panels cannot establish a direct peer-to-peer connection (due to NAT, firewall, or network topology), Tailscale falls back to DERP relay servers. Relay traffic adds significant latency (50-200ms depending on relay location), making the VPN chain unusable for latency-sensitive traffic.

**Why it happens:** Tailscale uses DERP (Designated Encrypted Relay for Packets) as a fallback when direct WireGuard connections cannot be established. DERP traffic is relayed through Tailscale's infrastructure, adding an extra hop. For VPN chains that already add latency from multiple hops, DERP relay can make the total latency unacceptable.

**Consequences:**
- Chain latency spikes from expected ~50ms to ~250ms+ when DERP relay kicks in
- Users experience noticeable slowdown
- The problem is intermittent -- appears when network conditions change
- Debugging is hard because Tailscale doesn't prominently show when relay mode is active

**Prevention:**
- Monitor connection type (direct vs relay) for each inter-panel link using `tailscale status` or the API
- Alert admin when any panel-pair connection falls back to DERP relay
- Configure firewall rules to allow direct WireGuard connections: UDP from port 41641 between panel servers
- If panels are in different cloud providers, consider enabling port forwarding for direct connections
- Document expected latency for each chain path and alert when actual latency exceeds threshold by >2x
- Consider running Tailscale nodes with `--advertise-exit-node` and direct connectivity requirements documented

**Detection:**
- `tailscale status` showing "relay" instead of "direct" for panel connections
- Latency monitoring showing spikes correlated with DERP fallback
- Tailscale API `connectionStatus` field on device resources

**Phase Addressed:** Tailscale Integration (v1.1 Phase 1)

**Confidence:** MEDIUM -- documented Tailscale behavior, specific latency impact depends on deployment

---

### Pitfall 13: SQLite Concurrency Limits Under Multi-Panel Push Load

**What goes wrong:** The central panel pushes chain configs to multiple remote panels simultaneously. Each push triggers database writes on the remote panel. SQLite's write locking causes some pushes to fail with "database is locked" errors.

**Why it happens:** SQLite allows only one writer at a time. With better-sqlite3 (synchronous driver), concurrent writes are serialized. If the central panel pushes to 3 remotes simultaneously and each remote also receives local user traffic that triggers DB writes, write contention increases. At the project's scale (1-3 servers, 50 users), this is unlikely to be a problem under normal load, but could manifest during bulk operations (mass config push + user activity).

**Consequences:**
- Intermittent "database is locked" errors during parallel config pushes
- Config push retries consuming time and potentially triggering timeouts
- Admin sees "push failed" for some panels but not others

**Prevention:**
- Use SQLite's WAL (Write-Ahead Logging) mode, which allows concurrent readers while a writer is active
- Implement exponential backoff with jitter for retry on "database is locked" errors
- Serialize config pushes from the central panel (push to one panel at a time) rather than parallelizing
- Set SQLite `busy_timeout` to a reasonable value (5 seconds) to let SQLite retry automatically
- Monitor SQLite write lock wait times and alert if they exceed threshold

**Detection:**
- Error logs showing "database is locked" or SQLITE_BUSY errors
- Config push operation timing exceeding expected duration
- SQLite performance monitoring

**Phase Addressed:** Multi-Panel Communication & Sync (v1.1 Phase 2)

**Confidence:** HIGH -- well-known SQLite behavior, but LOW probability at this project's scale

---

### Pitfall 14: Template System Doesn't Handle Protocol-Specific Constraints

**What goes wrong:** A pre-configuration template generates WireGuard configs that include Xray-specific settings, or vice versa. The template system doesn't enforce that only valid settings for the target protocol are included.

**Why it happens:** The existing `ConfigTemplate` model stores `content` as generic `Json` with a `protocol` string field, but there is no schema enforcement linking the protocol to the content structure. A template for "wireguard" could contain Xray routing rule fields, and nothing prevents that.

**Consequences:**
- Generated configs contain invalid fields that are silently ignored by the VPN service
- Missing required fields cause the VPN service to use defaults instead of intended values
- Admin confusion: "I set this field in the template but it's not being applied"

**Prevention:**
- Define JSON schemas for each protocol's config format (WireGuard INI schema, Xray JSON schema)
- Validate template content against the appropriate schema on template create/update
- Show protocol-specific fields in the template editor UI
- Add a "validate template" action that renders the template with test data and validates the output

**Detection:**
- Template validation errors on create/update
- Config apply warnings about unrecognized fields
- Service logs showing ignored configuration values

**Phase Addressed:** Pre-configuration Templates (v1.1 Phase 4)

**Confidence:** MEDIUM -- general software engineering concern

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Tailscale Integration | SNAT hiding source IPs (Pitfall 1) | Disable SNAT for inter-panel links, add return routes |
| Tailscale Integration | Overlapping route black holes (Pitfall 4) | Design non-overlapping subnet allocation, validate before apply |
| Tailscale Integration | `--accept-routes` loops (Pitfall 5) | Use `--advertise-routes` only for HA setups |
| Tailscale Integration | DERP relay latency (Pitfall 12) | Monitor connection type, alert on relay fallback |
| Tailscale Integration | Auth key expiry (Pitfall 10) | Use tags, disable key expiry, monitor via API |
| Multi-Panel Sync | Split-brain partial apply (Pitfall 2) | Implement two-phase commit with rollback |
| Multi-Panel Sync | API auth without rotation (Pitfall 8) | Use Tailscale transport + short-lived JWT tokens |
| Multi-Panel Sync | In-memory geo-routing loss (Pitfall 9) | Persist to SQLite, add startup self-check |
| Multi-Panel Sync | SQLite write contention (Pitfall 13) | WAL mode, serialized pushes, busy_timeout |
| Chain Routing | MTU collapse (Pitfall 3) | Calculate explicit MTU, MSS clamp everywhere, test with ping |
| Chain Routing | GeoIP staleness (Pitfall 6) | Weekly auto-update, staleness alerts, manual refresh button |
| Templates | Variable injection invalid configs (Pitfall 7) | Two-stage pipeline: render then validate |
| Templates | Protocol-agnostic content (Pitfall 14) | JSON schemas per protocol, validate on create/update |
| Templates | Static server-role assumptions (Pitfall 11) | Chain health check, config drift detection |

## Early Warning Signs

Watch for these indicators that you're heading toward a pitfall:

1. **SNAT Issues:** Geo-routing logs show traffic being classified for wrong geography, or traceroute shows unexpected source IPs
2. **Split-Brain:** Config push returns mixed success/failure, or remote panels report different config versions
3. **MTU Problems:** `ping -M do -s 1400` fails while `ping -s 500` succeeds on chain paths
4. **Route Black Holes:** Traffic to specific subnets drops when one panel goes offline despite "redundant" routes
5. **GeoIP Staleness:** Admin dashboard shows database older than 2 weeks, or routing anomalies for recently-reallocated IPs
6. **DERP Relay:** `tailscale status` shows "relay" for panel connections, latency monitoring shows 2x+ expected values
7. **Template Issues:** Service fails to start after template apply, config validation errors in logs
8. **Auth Key Expiry:** Tailscale device list shows key expiry dates approaching, panels dropping offline unexpectedly
9. **Config Drift:** Central panel shows config v5, remote panel shows config v3
10. **SQLite Locking:** "database is locked" errors in logs during parallel operations

## Prevention Checklist

Before implementing v1.1 features, verify:

- [ ] All inter-panel Tailscale links have SNAT disabled with return routes configured
- [ ] Subnet allocation scheme is non-overlapping across all panels
- [ ] Config push implements two-phase commit with rollback capability
- [ ] Chain config includes explicit MTU values calculated for encapsulation depth
- [ ] MSS clamping rules are applied at every tunnel entry point
- [ ] ICMP Type 3 Code 4 is allowed through all firewalls in the chain path
- [ ] GeoIP database has auto-update with staleness monitoring
- [ ] Template system validates rendered output against protocol-specific schemas
- [ ] Remote panel configs are persisted to SQLite (not in-memory)
- [ ] API tokens between panels are short-lived with scope restrictions
- [ ] Auth keys use tags with key expiry disabled
- [ ] Connection type monitoring alerts on DERP relay fallback
- [ ] SQLite WAL mode is enabled, busy_timeout configured

## Sources

- [Tailscale Subnet Routers](https://tailscale.com/kb/1019/subnets/) -- SNAT behavior, IP forwarding requirements (HIGH confidence)
- [Tailscale High Availability Setup](https://tailscale.com/docs/how-to/set-up-high-availability) -- Failover behavior, `--accept-routes` warning, overlapping routes (HIGH confidence, validated Oct 2025)
- [Tailscale Overlapping Subnet Route Failover](https://tailscale.com/docs/reference/troubleshooting/network-configuration/overlapping-subnet-route-failover) -- Route black hole behavior (HIGH confidence, validated Mar 2026)
- [Tailscale Ephemeral Nodes](https://tailscale.com/docs/features/ephemeral-nodes) -- Auth key lifecycle (HIGH confidence, validated Dec 2025)
- [Tailscale Firewall Ports](https://tailscale.com/docs/reference/faq/firewall-ports) -- Required ports for direct connections (HIGH confidence, validated Feb 2026)
- [Tailscale API Documentation](https://tailscale.com/kb/1210/tailscale-api) -- API authentication, rate limits (MEDIUM confidence)
- [WireGuard Asymmetric Routing (Reddit)](https://www.reddit.com/r/WireGuard/comments/wl33rw/assymetrical_routing_problem_with_iptables_and/) -- Asymmetric routing pitfalls (MEDIUM confidence)
- [WireGuard Access Control with iptables (Pro Custodibus)](https://www.procustodibus.com/blog/2021/04/wireguard-access-control-with-iptables/) -- MSS clamping, per-peer routing (MEDIUM confidence)
- [VPN Chaining with WireGuard (Medium)](https://allanjohn909.medium.com/vpn-chaining-with-wireguard-ec2bd500509e) -- Chain topology patterns (LOW confidence)
- PROJECT.md -- existing tech debt: in-memory geo-routing stores, stubbed CLI commands (HIGH confidence)
- Existing codebase: `chain-router.ts`, `geo-routing.ts`, `server-connection.ts`, `config-templates.ts`, `rule-enforcement.ts` -- current implementation patterns (HIGH confidence)
