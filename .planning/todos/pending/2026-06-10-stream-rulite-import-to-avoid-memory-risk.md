---
created: 2026-06-10T23:09:29.203Z
title: Stream rulite import instead of fs.readFileSync
area: api
files:
  - src/lib/routing-rule-templates.ts:399-410
---

## Problem

`src/lib/routing-rule-templates.ts:399-410` uses `fs.readFileSync` for the rulite parser import, loading the entire file into memory. This reintroduces the same memory-risk pattern that was previously fixed for GeoIP data (which now uses streaming with backpressure). For large routing rule files, this could cause heap pressure.

## Solution

Replace `fs.readFileSync` with a streaming approach (readline interface or transform stream) that processes the rulite file line-by-line, consistent with the GeoIP streaming pattern already established in the codebase.
