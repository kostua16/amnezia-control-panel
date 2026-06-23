---
status: resolved
trigger: "better-sqlite3 native binding is absent from the Docker standalone image (npm ci --ignore-scripts skips it); investigate whether the app crashes at runtime and fix provisioning"
created: 2026-06-23
updated: 2026-06-23
---

# Debug: better-sqlite3 native binary missing from Docker standalone image

## Symptoms

- **Expected:** the Docker standalone production image runs the app and Prisma's
  better-sqlite3 adapter can open the SQLite database at runtime.
- **Actual (observed):** the standalone image's `/app/node_modules/better-sqlite3/`
  ships the JS package, but the native `better_sqlite3.node` binary is absent. A
  full image scan found only **2** `*.node` files — both `@img/sharp-*` prebuilts.
- **Error:** runtime failure not yet reproduced — needs confirmation.
- **Timeline:** pre-existing. Surfaced 2026-06-22 during #490 Docker-build
  verification. The `npm ci --ignore-scripts` predates the Node 24 bump, so the
  absence is identical on Node 22 and Node 24 (orthogonal to #490).
- **Reproduction:** build image, `require('better-sqlite3')` inside the container.

## Suspected mechanism

1. Dockerfile `deps` stage: `npm ci --ignore-scripts` → skips better-sqlite3's
   `install` lifecycle (`prebuild-install || node-gyp-build`) → no native binary
   fetched or compiled.
2. `builder` stage `next build` → standalone output traces the JS package, but no
   binary exists to trace into `.next/standalone`.
3. `runner` stage copies `.next/standalone` (JS only, no binary).
4. `docker-entrypoint.sh` runs `prisma migrate deploy` + `node server.mjs` — no
   native rebuild.

## Current Focus

- **hypothesis:** better-sqlite3's native binding is never provisioned into the
  standalone image (`--ignore-scripts`), so `require('better-sqlite3')` throws at
  runtime → app crashes on first DB access.
- **next_action:** reproduce by loading better-sqlite3 inside the built container;
  capture the exact throw. Then trace how the binding is meant to resolve and fix.

## Evidence

- 2026-06-23: built `amnezia-cp:bsql3-debug` from main (post-#490); full
  multi-stage image assembles cleanly (deps → builder → runner).
- 2026-06-23: `find / -name "*.node"` in runner image → 2 hits, both
  `@img/sharp-linux*` prebuilts; no `better_sqlite3.node`.
- 2026-06-23: `/app/node_modules/better-sqlite3/package.json` IS present in
  standalone (JS traced), but no `build/Release/*.node`.
- 2026-06-23: **REPRODUCED.** Mounted a probe into the container:
  `require('better-sqlite3')` THROWS on node v24.16.0:
  `Could not locate the bindings file. Tried: …/build/Release/better_sqlite3.node`
  (7 candidate paths, all absent). Confirms a runtime crash on first DB access.

## Eliminated

- (not a Node-24 ABI issue) The binding is never compiled on ANY node version —
  `--ignore-scripts` skips the install step regardless of major. Orthogonal to #490.

## Root Cause

`npm ci --ignore-scripts` (added deliberately in `5c621db` as supply-chain
hardening — no arbitrary install scripts during the image build) also skips
better-sqlite3's `install` lifecycle (`prebuild-install || node-gyp-build`),
so no `better_sqlite3.node` is fetched or compiled. Next.js standalone traces
the JS package but has no binary to trace. The runner copies standalone (JS
only); the entrypoint does not rebuild. Result: `require('better-sqlite3')`
throws at runtime.

## Fix

Keep `--ignore-scripts` (preserve the security hardening) and explicitly rebuild
only the native module that needs it, right after the dependency install in the
deps stage:

```
RUN npm rebuild better-sqlite3
```

`npm rebuild <pkg>` runs just that package's install/rebuild script (using the
already-installed `python3 make g++` toolchain), leaving all other packages'
scripts disabled. This matches the deps-stage comment ("native modules are built
here"). Verify the binary lands in the standalone trace; if Next.js does not
trace `.node` files, fall back to an explicit `COPY` in the runner stage.

## Verification

- 2026-06-23: re-assembled image with the fix → `/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node` is now present (3rd `*.node`, alongside the 2 sharp prebuilts).
- 2026-06-23: re-ran the probe → `LOAD+OPEN OK | node v24.16.0`. `require('better-sqlite3')` loads and opens an in-memory DB. The binary was traced into the standalone output automatically (no explicit runner-stage COPY needed).
- Prisma's better-sqlite3 adapter uses this exact require/open path, so the runtime crash on first DB access is resolved.

## Files changed

- `Dockerfile` — add `RUN npm rebuild better-sqlite3` after `npm ci --ignore-scripts` (deps stage).
