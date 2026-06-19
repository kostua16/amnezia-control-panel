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

2. Build a hostname→server lookup:
   ```
   const serverByHost = new Map<string, typeof allServers[0]>();
   for (const s of allServers) {
     serverByHost.set(s.hostname, s);
     if (s.tailnetIP) serverByHost.set(s.tailnetIP, s);
     if (s.tailnetHostname) serverByHost.set(s.tailnetHostname, s);
   }
   ```

3. In the loop, replace `prisma.server.findFirst(...)` with `serverByHost.get(hostname)`.

## Impact

- Reduces DB queries from 2N to N+1 during panel push.
- Eliminates redundant URL parsing per panel.
- No behavior change — same transport resolution, fewer DB round-trips.
- Low risk: pure lookup refactor, same data sources.

## Files

- `src/lib/panel-sync-client.ts` — batch server fetch before loop
- `src/lib/__tests__/panel-sync-client.test.ts` — update test expectations
