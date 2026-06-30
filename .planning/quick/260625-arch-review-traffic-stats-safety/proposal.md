# Quick Task 260625: Traffic stats query safety — unbounded date ranges

## Problem

The aggregate traffic stats API route (`/api/stats/traffic`) uses `$queryRaw` with date range parameters from query strings. There is no validation on the date range size. A request like `?from=2025-01-01&to=2026-12-31` forces SQLite to scan the full 2-year traffic log table (potentially millions of rows for 50 users × 3 servers). `/api/stats/traffic/users` is safer already because it derives its cutoff from an enum `period` and applies a bounded `LIMIT`, but the aggregate route can still:

1. Hold a read lock on `traffic_logs` for seconds, blocking the cleanup job and write operations.
2. Return an unbounded result set consuming significant memory.
3. Be exploited (even unintentionally) to degrade the panel's responsiveness.

The traffic log cleanup job (`traffic-log-cleanup.ts`) retains 90 days of data by default, but the aggregate API route does not enforce that queries stay within that window.

## Scope

### 1. Clamp query date range to retention window

- **files**: `src/app/api/stats/traffic/route.ts`
- **action**:
  - Parse `from`/`to` query params.
  - Clamp `from` to no earlier than `now - RETENTION_DAYS`.
  - Clamp `to` to no later than `now`.
  - Clamp maximum range to 90 days (or the configured `RETENTION_DAYS`).
  - Return 422 if the requested range exceeds the limit.
- **verify**: Request with `from=2020-01-01` → automatically clamped to 90 days ago. Request with 180-day range → 422.

### 2. Add `LIMIT` to raw queries

- **files**: `src/app/api/stats/traffic/route.ts`
- **action**: Add a `LIMIT 10000` (or configurable) to the `$queryRaw` queries as a safety bound. If the query hits the limit, return a warning header (`X-Result-Truncated: true`) so the frontend can inform the admin.
- **verify**: Large dataset → response includes truncation header, no unbounded memory growth.

### 3. Consider switching to Prisma ORM queries

- **files**: `src/app/api/stats/traffic/route.ts`; optionally compare with `src/app/api/stats/traffic/users/route.ts`
- **action**: The `$queryRaw` queries do date-range aggregation (`SUM(bytesIn)`, `GROUP BY userId`). Evaluate whether Prisma's `groupBy` + `where` can replace the raw SQL. ORM queries are safer from injection and get automatic type checking.
- **verify**: If migrated, traffic stats return identical results to the raw SQL version.

## Acceptance Criteria

- [ ] Date range params clamped to retention window
- [ ] Maximum range enforced (422 on violation)
- [ ] Raw queries have a hard LIMIT as safety bound
- [ ] No unbounded full-table scans possible from the API

## Estimated Effort

~2 hours. One route file + validation logic, plus a comparison pass against the already bounded top-users route.
