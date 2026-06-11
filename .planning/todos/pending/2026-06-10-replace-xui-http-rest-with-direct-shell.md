---
created: 2026-06-10T23:09:29.203Z
title: Replace 3x-ui HTTP REST calls with direct shell access
area: api
files:
  - src/lib/vpn-services.ts:539-619
  - src/lib/vpn-services.ts:670-727
---

## Problem

`src/lib/vpn-services.ts` lines 539-619 and 670-727 use HTTP REST via curl to `XUI_BASE_URL` for 3x-ui panel lifecycle operations (start/stop/restart/status). CLAUDE.md architecture says "Direct shell access to Amnezia AWG and 3x-ui services" and "Single-server deployment". The HTTP approach is inconsistent with the Amnezia AWG side which uses direct shell commands, and introduces unnecessary network dependency for a same-server deployment.

## Solution

Replace curl-based HTTP calls with direct shell commands (`systemctl start/stop/restart/status 3x-ui` or equivalent). Align the 3x-ui lifecycle management pattern with the Amnezia AWG pattern already in the codebase. Remove `XUI_BASE_URL` dependency for lifecycle operations.
