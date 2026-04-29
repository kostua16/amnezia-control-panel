---
status: complete
task_id: "260429-b7k"
description: "migrate middleware to proxy convention"
date: "2026-04-29"
---

# Quick Task 260429-b7k: migrate middleware to proxy

## Summary

Migrated from deprecated Next.js 16 `middleware` convention to `proxy` convention.
- Renamed `src/middleware.ts` → `src/proxy.ts`
- Renamed exported function `middleware()` → `proxy()`
- Updated comments

No `next.config.ts` changes needed (no middleware-specific config present).

## Changes

- `src/middleware.ts` → deleted
- `src/proxy.ts` → created (identical logic, new convention)

## Verification

- `export function proxy()` confirmed in `src/proxy.ts`
- No references to `middleware.ts` remain in source
