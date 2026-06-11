---
created: 2026-06-10T23:09:29.203Z
title: Restrict XUI_BASE_URL to localhost/127.0.0.1
area: api
files:
  - src/lib/vpn-services.ts:146-151
---

## Problem

`XUI_BASE_URL` in `src/lib/vpn-services.ts:146-151` accepts arbitrary URLs without validation, permitting off-box panel management. This contradicts the single-server deployment constraint documented in CLAUDE.md. If remote URLs are allowed, the panel could issue requests to arbitrary hosts (SSRF risk for admin-facing operations).

## Solution

Add URL validation to reject anything other than `localhost`, `127.0.0.1`, or `[::1]`. Apply at config load time (environment variable parsing or settings validation). Fail fast with a clear error if an external URL is provided.
