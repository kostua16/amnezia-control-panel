---
status: resolved
trigger: "CI Build job failed on dev6 with Turbopack unable to download Geist woff2 from fonts.gstatic.com"
created: 2026-05-29T21:32:00Z
updated: 2026-05-29T22:17:00Z
---

## Current Focus

hypothesis: Confirmed. `dev6` cannot establish TCP/443 to `fonts.gstatic.com` while `fonts.googleapis.com`, GitHub, and npm registry work.
test: User curl from dev6 + local build after self-hosting fonts.
expecting: Build passes on dev6 without gstatic traffic.
next_action: Push and re-run CI Build on dev6.

## Symptoms

expected: `npm run build` succeeds on all self-hosted runners.
actual: Build failed on `dev6` with 11 Turbopack font download connection errors to `fonts.gstatic.com`.
errors: `There was an issue establishing a connection while requesting https://fonts.gstatic.com/s/geist/...`
reproduction: Cold `next build` on `dev6` with `next/font/google` (Geist + Geist Mono in `src/app/layout.tsx`).

## Evidence

- timestamp: 2026-05-29T21:33:50Z
  checked: GitHub Actions run #26663122321 Build log
  found: Runner `dev6`; Next.js cache miss; 11 gstatic woff2 fetch failures; cascading `@vercel/turbopack-next/internal/font/google/font` module errors.
  implication: Build requires gstatic when using `next/font/google` without warm `.next/cache/google-fonts`.

- timestamp: 2026-05-29T21:48:00Z
  checked: curl from dev6 (user)
  found: `fonts.googleapis.com` (203.208.50.97) connects; `fonts.gstatic.com` (203.208.50.98) IPv4 timeout; IPv6 unreachable.
  implication: Not a general outbound block — targeted gstatic CDN unreachable from dev6 network.

- timestamp: 2026-05-29T22:10:00Z
  checked: Local `npm run build` after `next/font/local`
  found: Build succeeds; no gstatic URLs in output.
  implication: Self-hosted fonts remove compile-time dependency on gstatic.

## Resolution

Committed Geist v1.7.1 variable `.woff2` files under `src/app/fonts/` and switched `src/app/layout.tsx` to `next/font/local`. See `.planning/quick/260529-geist-local-fonts/260529-geist-SUMMARY.md`.
