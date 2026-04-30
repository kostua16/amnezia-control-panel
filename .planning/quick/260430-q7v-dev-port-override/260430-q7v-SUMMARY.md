---
status: complete
task_id: "260430-q7v"
description: "dev script default port with CLI/env override"
date: "2026-04-30"
---

# Quick Task 260430-q7v: dev script default port with CLI/env override

## Summary

Replaced inline `next dev --port 3333` with `node scripts/dev.cjs` so extra CLI flags are not duplicated against a hardcoded port. Default port 3333 applies only when no port is specified via argv or `PORT`.

## Changes

- `scripts/dev.cjs`: spawn Next CLI with conditional `-p 3333`
- `package.json`: `"dev": "node scripts/dev.cjs"`

## Verification

- `npm run dev -- --port 3334` shows Next listening on port 3334
