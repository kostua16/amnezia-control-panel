---
created: 2026-06-10T23:09:29.203Z
title: Add audit logging to routing import endpoint
area: api
files:
  - src/app/api/routing/import/route.ts
  - src/lib/audit-log.ts
---

## Problem

`src/app/api/routing/import/route.ts` has no audit logging despite geo/rulite import being an admin-affecting operation. Other admin operations in the codebase emit audit records, but the routing import path is a gap. Failed validation/auth paths also don't emit audit records.

## Solution

Add `AuditLog` calls to the routing import route for: successful imports, failed imports (validation errors), and auth failures. Use the same audit pattern established in other admin API routes.
