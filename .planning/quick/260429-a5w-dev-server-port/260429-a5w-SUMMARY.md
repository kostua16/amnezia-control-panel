---
status: complete
task_id: "260429-a5w"
description: "change dev server port from 3000 to 3333"
date: "2026-04-29"
---

# Quick Task 260429-a5w: change dev server port from 3000 to 3333

## Summary

Changed Next.js dev server port from default 3000 to 3333 by adding `--port 3333` flag to the `dev` script in `package.json`.

## Changes

- `package.json`: `"dev": "next dev"` → `"dev": "next dev --port 3333"`

## Verification

- `grep "3333" package.json` confirms port flag present
