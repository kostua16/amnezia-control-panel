# Architectural Review Pass 16 (2026-07-20)

Non-duplicative vs proposals #1-#43 and open PRs.

## Dedup

Excluded open PR topics (all workflow/automation, no source overlap):
- #854: auto-PR audit workflow
- #852: stale automation-PR close-list
- #850, #815, #795: maintenance persists
- #827: report-failure path for infra errors

## Proposals

### #44: `servers/[id]/config` PUT non-atomic multi-table update

**Severity:** Medium (Consistency)
**File:** `src/app/api/servers/[id]/config/route.ts:131-164`

**Problem:**
The PUT handler updates server-level fields via `prisma.server.update()` (line 159-164), then iterates service overrides in a sequential for-loop (line 136-155), each calling `prisma.service.update()` individually. No `prisma.$transaction()` wraps the operation.

If `prisma.server.update()` succeeds but a service override fails mid-loop (e.g., constraint violation, DB lock), the server fields are committed but remaining service overrides are skipped. The admin sees a partial update with no rollback.

**Distinct from #4:** Proposal #4 targets `users/[id]/route.ts` for user lifecycle transactions. This is a different route family (`servers/[id]/config`) with the same class of bug but different tables and a different fix scope.

**Fix:** Wrap lines 131-164 in `prisma.$transaction()`. The server update and all service override updates execute atomically — either all commit or all roll back.

---

### #45: Audit log fire-and-forget loses compliance trail

**Severity:** Medium (Security/Compliance)
**File:** `src/lib/audit-log.ts:14-29`

**Problem:**
`writeAuditLog()` catches every `prisma.auditLog.create()` error in a try/catch and logs to `console.error` only (line 26-28). No alert is created, no metric is incremented, and no admin-visible signal is emitted.

If the `audit_logs` table is corrupted, the SQLite WAL checkpoint stalls, or the disk fills up, ALL audit events silently vanish — login events, user CRUD operations, config pushes, sync receives, server changes. The admin has zero visibility that the audit trail has stopped recording.

For a panel managing VPN user access and security configurations, losing the audit trail is a compliance gap. An attacker who gains write access to the DB could corrupt the audit table and then operate without leaving evidence.

**Fix:**
1. Track consecutive audit-write failure count in a module-level counter.
2. When failures exceed a threshold (e.g., 3 consecutive), emit an `Alert` record (`alert-service.ts`) with severity CRITICAL: "Audit log write failures detected — compliance trail may be incomplete".
3. Reset the counter on successful write.
4. Add an audit-health check to the broadcaster's daily cycle (alongside traffic-log cleanup) that verifies the audit table is writable.

---

### #46: ~20 API routes bypass `apiHandler` — missing Prisma error classification

**Severity:** Medium (Maintainability)
**Files:** `src/app/api/servers/[id]/config/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/routing/rules/route.ts`, `src/app/api/routing/whitelist/route.ts`, `src/app/api/routing/templates/route.ts`, `src/app/api/routing/rules/batch/route.ts`, `src/app/api/routing/rules/reorder/route.ts`, `src/app/api/routing/templates/[id]/route.ts`, `src/app/api/routing/templates/seed/route.ts`, `src/app/api/routing/whitelist/[id]/route.ts`, `src/app/api/sync/apply/route.ts`, `src/app/api/sync/receive/route.ts`, `src/app/api/sync/status/route.ts`, `src/app/api/tailscale/nodes/route.ts`, `src/app/api/tailscale/setup/advertise/route.ts`, `src/app/api/tailscale/setup/verify/route.ts`, `src/app/api/tailscale/status/route.ts`, `src/app/api/users/[id]/block/route.ts`, `src/app/api/users/[id]/quota/route.ts`, `src/app/api/users/[id]/speed/route.ts`, `src/app/api/users/[id]/unblock/route.ts`, `src/app/api/stats/traffic/route.ts`, `src/app/api/stats/traffic/users/route.ts`

**Problem:**
~23 routes use manual try/catch with inline `NextResponse.json({ success: false, error: ... })` instead of the `apiHandler` wrapper. These routes don't benefit from centralized Prisma error classification:
- P2025 (Not Found) → 404 (some routes return generic 500)
- P2002 (Unique Violation) → 409 (some routes handle it manually but inconsistently)
- Future Prisma error codes → must be added in 20+ places instead of one

Example: `servers/[id]/config` (line 213-226) manually handles P2002 with a specific 409 message. `users/route.ts` POST uses `apiHandler` and gets it automatically. Same error class, different handling path.

**Distinct from #2:** Proposal #2 created the `apiHandler` abstraction. This proposal is about completing the migration of remaining routes to use it.

**Fix:**
1. Migrate all ~23 routes to `apiHandler` with appropriate labels.
2. For routes with route-specific Prisma handling (like `servers/[id]/config`'s P2002), extend `apiHandler` with an optional per-label override map so route-specific error mapping stays declarative without duplicating try/catch.
3. Remove duplicate manual catch blocks.
