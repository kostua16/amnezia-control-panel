---
created: 2026-05-29T22:17:31.609Z
completed: 2026-05-29T22:17:31.609Z
title: Self-host Geist fonts for dev6 CI
area: ui
files:
  - src/app/layout.tsx
  - src/app/globals.css
  - src/app/fonts/Geist-Variable.woff2
  - src/app/fonts/GeistMono-Variable.woff2
  - src/app/fonts/OFL.txt
  - README.md
---

## Problem

CI Build on self-hosted runner `dev6` failed because `next/font/google` downloaded Geist fonts from `fonts.gstatic.com` at build time. `dev6` cannot reach gstatic (IPv4 timeout) though `fonts.googleapis.com`, GitHub, and npm work. Run #26663122321.

## Solution

Implemented: committed Geist v1.7.1 variable woff2 files under `src/app/fonts/`, switched to `next/font/local`, updated README and body font-family. Documented in `.planning/quick/260529-geist-local-fonts/` and `.planning/debug/gh-run-26663122321-dev6-gstatic-fonts.md`.
