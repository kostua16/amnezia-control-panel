# Batch server lookups in panel-sync push

## Problem

`pushConfigToAllPanels()` in `src/lib/panel-sync-client.ts:183-273` queries the database
per panel inside a loop to resolve Tailscale transport addresses.

For each panel, lines 224-252 run:
```
prisma.server.findFirst({
  where: {
    OR: [
      { hostname: { contains: new URL(panel.panelUrl).hostname } },
      { tailnetIP: { equals: new URL(panel.panelUrl).hostname } },
    ],
  },
  select: { id: true, tailnetIP: true, tailnetHostname: true, hostname: true },
});
```

Then `resolvePanelTransport()` may do additional writes (cache-back to DB) per server.

With N panels: N `findMany` (active panels) + N `findFirst` (server lookup) = 2N queries
where 1+N would suffice.

## Evidence

- `src/lib/panel-sync-client.ts:189` — `prisma.remotePanel.findMany({ where: { isActive: true } })`
- `src/lib/panel-sync-client.ts:224-237` — per-panel `prisma.server.findFirst()` inside for-loop
- `src/lib/panel-sync-client.ts:196-260` — sequential iteration over panels

The server lookup also constructs a `new URL(panel.panelUrl).hostname` on each iteration,
which is redundant parsing work.

## Fix

1. Before the loop, fetch all servers in a single query:
   ```
   const allServers = await prisma.server.findMany({
     select: { id: true, tailnetIP: true, tailnetHostname: true, hostname: true },
   });
   ```

2. Build a lookup helper that preserves current `contains` + `equals` semantics:
   ```
   function findServerByHost(
     servers: typeof allServers,
     urlHostname: string,
   ) {
     // Exact match on tailnetIP (mirrors `tailnetIP: { equals }`)
     const byIP = servers.find((s) => s.tailnetIP === urlHostname);
     if (byIP) return byIP;
     // Substring match on hostname (mirrors `hostname: { contains }`)
     return servers.find((s) => s.hostname.includes(urlHostname));
   }
   ```

3. In the loop, replace `prisma.server.findFirst(...)` with `findServerByHost(allServers, hostname)`.

> **Behavioral equivalence note:** The original query uses `hostname: { contains: urlHostname }` (substring match) and `tailnetIP: { equals: urlHostname }` (exact match) with Prisma's default `findFirst` ordering. A naive `Map.get()` would be an exact-only lookup and would silently drop matches where the panel URL hostname is a substring of the server hostname (e.g. panel `vpn-server-1` matching server `vpn-server-1.tail-scale.ts.net`). The `findServerByHost` helper above preserves both match modes.

## Impact

- Reduces DB queries from 2N to N+1 during panel push.
- Eliminates redundant URL parsing per panel.
- Reduces DB queries from 2N to N+1 during panel push.
- Eliminates redundant URL parsing per panel.
- Behavior preserved — lookup function mirrors Prisma `contains`+`equals` semantics exactly.
- Low risk: pure lookup refactor, same data sources, same match semantics.

## Files

- `src/lib/panel-sync-client.ts` — batch server fetch before loop
- `src/lib/__tests__/panel-sync-client.test.ts` — update test expectations
