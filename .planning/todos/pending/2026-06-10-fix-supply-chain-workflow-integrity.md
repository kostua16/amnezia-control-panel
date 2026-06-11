---
created: 2026-06-10T23:09:29.203Z
title: Fix supply-chain.yml npm audit signatures integrity
area: tooling
files:
  - .github/workflows/supply-chain.yml
---

## Problem

`.github/workflows/supply-chain.yml` has `npm audit signatures` with `continue-on-error: true`, so signature verification failures don't fail the workflow. This undermines the supply chain integrity check — a compromised package would not block CI.

## Solution

Remove `continue-on-error: true` from the npm audit signatures step, or add a separate verification step that fails the workflow on signature mismatches while keeping the audit informational.
