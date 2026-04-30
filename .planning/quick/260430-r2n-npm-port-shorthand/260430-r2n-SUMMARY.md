---
status: complete
task_id: "260430-r2n"
description: "support npm --port shorthand and explain Next same-project dev-server lock"
date: "2026-04-30"
---

# Quick Task 260430-r2n: support npm --port shorthand and clarify Next multi-server behavior

## Summary

Updated `scripts/dev.cjs` to normalize npm shorthand so `npm run dev --port 3334` works without requiring `-- --port 3334`. Also confirmed that Next.js blocks multiple `next dev` processes for the same project directory, even if ports differ.

## Changes

- `scripts/dev.cjs`: parse npm `npm_config_port` patterns and strip positional `3334` when npm passes `--port 3334` as config+arg.

## Verification

- `npm run dev --port 3334` now binds `http://localhost:3334` (npm still warns that `--port` is an npm CLI config).
- Existing `npm run dev -- --port 3334` remains functional.
