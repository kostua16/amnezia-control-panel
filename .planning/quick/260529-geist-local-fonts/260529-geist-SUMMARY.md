---
status: complete
task_id: "260529-geist"
description: "Self-host Geist fonts for dev6 CI build"
date: "2026-05-29"
---

# Quick Task 260529-geist: Self-host Geist fonts for dev6 CI

## Summary

CI **Build** failed on self-hosted runner `dev6` because Turbopack fetched Geist `.woff2` files from `fonts.gstatic.com` during `next build`. `dev6` can reach `fonts.googleapis.com` but **cannot connect** to `fonts.gstatic.com` (IPv4 timeout to `203.208.50.98`; IPv6 unreachable).

Replaced `next/font/google` with committed variable fonts via `next/font/local` so builds never contact Google CDN at compile time.

## Root cause

- Run: [#26663122321](https://github.com/kostua16/amnezia-control-panel/actions/runs/26663122321)
- Runner: `dev6` (Linux)
- Error: `There was an issue establishing a connection while requesting https://fonts.gstatic.com/s/geist/...`
- `github.com` and `registry.npmjs.org` work on `dev6`; `fonts.gstatic.com` does not

## Changes

| Path | Change |
|------|--------|
| `src/app/fonts/Geist-Variable.woff2` | Geist Sans variable font (geist@1.7.1) |
| `src/app/fonts/GeistMono-Variable.woff2` | Geist Mono variable font (geist@1.7.1) |
| `src/app/fonts/OFL.txt` | SIL OFL license |
| `src/app/layout.tsx` | `next/font/local` with same `--font-geist-sans` / `--font-geist-mono` variables |
| `src/app/globals.css` | `body` uses `var(--font-sans)` |
| `README.md` | Documents self-hosted fonts |

No `geist` npm dependency. No CI workflow changes required.

## Verification

- `npx prisma generate && npm run build` — passes locally, no `fonts.gstatic.com` in output
- Pending: push and confirm **Build** on `dev6`

## References

- Debug: `.planning/debug/gh-run-26663122321-dev6-gstatic-fonts.md`
- Plan: `.cursor/plans/local_geist_fonts_763b8f2a.plan.md`
