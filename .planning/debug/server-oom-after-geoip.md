---
status: fixing
trigger: "Investigate server failure once download geoip file (terminal OOM after POST /api/geoip/refresh)"
created: 2026-05-02
updated: 2026-05-02
---

## Symptoms

- **Expected:** GeoIP refresh completes; dev server stays up.
- **Actual:** Process crashes with `FATAL ERROR: ... JavaScript heap out of memory` shortly after refresh; GC logs show ~3.8–4.1 GB heap before failure.
- **Errors:** `[geoip] Failed to download from https://github.com/v2fly/...` (timeout); then successful download from jsdelivr (~23 MB); `[geoip] Loaded 251 countries from geoip.dat`; later unrelated API 200s; then OOM.
- **Timeline:** First seen during manual refresh in dev (`next dev`).
- **Reproduction:** Trigger `POST /api/geoip/refresh` (or scheduled refresh) with full v2fly `geoip.dat` while dev server is already memory-heavy.

## Current Focus

hypothesis: Peak memory during refresh comes from (1) keeping the downloaded `ArrayBuffer`/`Buffer` alive while `loadFromFile()` does `readFileSync` (second full copy on disk read), plus (2) building a large intermediate `results` array during protobuf decode before filling `this.countries`. Next.js dev baseline makes this cross the default V8 heap limit.
next_action: Re-run dev server, trigger `POST /api/geoip/refresh`, confirm process stays up and memory stays lower than pre-fix spike.

## Evidence

- timestamp: 2026-05-02 — Terminal: GitHub URL `AbortSignal.timeout` / TimeoutError; jsdelivr success 23569212 bytes; load log 251 countries; POST `/api/geoip/refresh` ~3.4min; then `Mark-Compact` near 4GB; fatal OOM.
- timestamp: 2026-05-02 — `src/lib/geoip-manager.ts`: `refresh()` uses `arrayBuffer` + `Buffer.from` then `await loadFromFile()` in same function scope; `parseDatFile` uses `readFileSync` (another full buffer); `decodeGeoIPProtobuf` allocates `results: Array<...>` for all countries before copying to `Map`.

## Eliminated

- hypothesis: Primary failure is GitHub CDN timeout — eliminated: fallback URL succeeded; crash occurred after successful load.

## Resolution

root_cause: GeoIP refresh held the full download buffer in `refresh()` until the function returned while `loadFromFile()` allocated another full-file buffer via `readFileSync`. Protobuf decode also built a full `results` array duplicate of country entries before merging into the `Map`, increasing peak RSS/heap alongside an already heavy `next dev` process.

fix: Stream `fetch` body to `geoip.dat.tmp` with `pipeline(Readable.fromWeb(...), writeStream)` so no multi-megabyte `arrayBuffer`/`Buffer` lingers into reload; replace `decodeGeoIPProtobuf` + loop with `decodeGeoIPProtobufIntoCountries` that writes directly into `this.countries`. Follow-up: replace `pipeline`/`fromWeb` with `getReader()` + `createWriteStream({ highWaterMark: 8192 })` + `drain` backpressure so the writable side stays ~8KiB-buffered; put jsdelivr URL first to skip slow GitHub `latest` timeouts.

verification: `src/lib/geoip-manager.ts` passes ESLint; full-project `tsc` still reports pre-existing errors in other files, none in geoip-manager after `ReadableStream` cast.

files_changed: src/lib/geoip-manager.ts, .planning/debug/server-oom-after-geoip.md
