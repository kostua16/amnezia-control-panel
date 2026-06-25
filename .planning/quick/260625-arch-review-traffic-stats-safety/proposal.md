# Quick Task 260625: Traffic stats query safety — unbounded date ranges

## Problem

The traffic stats API routes (`/api/stats/traffic` and `/api/stats/traffic/users`) use `$queryRaw` with date range parameters from query strings. There is no validation on the date range size. A request like `?from=2025-01-01&to=2026-12-31` forces SQLite to scan the full 2-year traffic log table (potentially millions of rows for 50 users × 3 servers). This can:

1. Hold a read lock on `traffic_logs` for seconds, blocking the cleanup job and write operations.
2. Return an unbounded result set consuming significant memory.
3. Be exploited (even unintentionally) to degrade the panel's responsiveness.

The traffic log cleanup job (`traffic-log-cleanup.ts`) retains 90 days of data by default, but there's no enforcement that API queries stay within that window.

## Scope

### 1. Clamp query date range to retention window

- **files**: `src/app/api/stats/traffic/route.ts`, `src/app/api/stats/traffic/users/route.ts`
- **action**:
  - Parse `from`/`to` query params.
  - Clamp `from` to no earlier than `now - RETENTION_DAYS`.
  - Clamp `to` to no later than `now`.
  - Clamp maximum range to 90 days (or the configured `RETENTION_DAYS`).
  - Return 422 if the requested range exceeds the limit.
- **verify**: Request with `from=2020-01-01` → automatically clamped to 90 days ago. Request with 180-day range → 422.

### 2. Add `LIMIT` to raw queries

- **files**: same traffic routes
- **action**: Add a `LIMIT 10000` (or configurable) to the `$queryRaw` queries as a safety bound. If the query hits the limit, return a warning header (`X-Result-Truncated: true`) so the frontend can inform the admin.
- **verify**: Large dataset → response includes truncation header, no unbounded memory growth.

### 3. Consider switching to Prisma ORM queries

- **files**: same traffic routes
- **action**: The `$queryRaw` queries do date-range aggregation (`SUM(bytesIn)`, `GROUP BY userId`). Evaluate whether Prisma's `groupBy` + `where` can replace the raw SQL. ORM queries are safer from injection and get automatic type checking.
- **verify**: If migrated, traffic stats return identical results to the raw SQL version.

## Acceptance Criteria

- [ ] Date range params clamped to retention window
- [ ] Maximum range enforced (422 on violation)
- [ ] Raw queries have a hard LIMIT as safety bound
- [ ] No unbounded full-table scans possible from the API

## Estimated Effort

~2 hours. Two route files + validation logic.
