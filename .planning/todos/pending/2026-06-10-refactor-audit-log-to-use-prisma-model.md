---
created: 2026-06-10T23:09:29.203Z
title: Refactor audit-log.ts to use Prisma model layer
area: database
files:
  - src/lib/audit-log.ts:16-58
  - prisma/schema.prisma
  - prisma/migrations/
---

## Problem

`src/lib/audit-log.ts` uses raw SQL (`$executeRawUnsafe` / `$executeRaw`) for DDL and INSERT operations, bypassing the Prisma model layer entirely. An `AuditLog` model and migration already exist in the Prisma schema. CLAUDE.md states "Prisma + SQLite for data storage" — raw SQL violates the established data access pattern and loses type safety, query composition, and migration consistency.

## Solution

Replace all `$executeRawUnsafe`/`$executeRaw` calls with Prisma client methods (`prisma.auditLog.create()`, `prisma.auditLog.findMany()`, etc.). Remove the DDL table creation since the migration handles schema. Ensure all callers use the Prisma-based interface.
