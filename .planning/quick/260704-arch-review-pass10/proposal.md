# Architectural Review Pass 10 (2026-07-04)

Source: `/gsd:explore` tenth-pass review (non-duplicative vs proposals #1-#27 and open PRs).

## Findings

### #28: Remove dead PanelConnectionHistory model

**Severity:** Low (Cleanup)
**Area:** `prisma/schema.prisma` (lines 331-345), `src/lib/panel-health-checker.ts:484`, `src/app/api/panels/[id]/status/route.ts:31`

**Problem:** `PanelConnectionHistory` model has indexes but zero `create()` calls anywhere in the codebase. Two read queries exist (`findFirst` in `getPanelStatus()`, `findMany` in `panels/[id]/status/route.ts`), both wrapped in try/catch with "table may not exist" comments — confirming the table is never populated. The health checker writes to an in-memory `healthSnapshotCache` Map instead. This dead schema adds migration overhead and confuses developers into thinking connection history is persisted.

**Change:** Remove the `PanelConnectionHistory` model and its `@@index` directives from `prisma/schema.prisma`. Remove the `connectionHistory` relation from `RemotePanel`. Remove the two dead read queries in `panel-health-checker.ts:484-505` and `panels/[id]/status/route.ts`. Run `prisma generate` + migration.

**Benefit:** Eliminates dead code, removes a confusing "table may not exist" comment pattern, simplifies the Prisma schema by one model.

---

### #29: Config import payload size guard

**Severity:** Medium (Ops/Security)
**Area:** `src/app/api/configs/import/route.ts`, `src/lib/config-import.ts`

**Problem:** `POST /api/configs/import` accepts unbounded JSON payloads via multipart file upload or raw body. The `importConfigs()` function iterates arrays of configurations and templates with no max-length check. Each entry does a sequential `findFirst` + `create`/`update` — an import with 10,000 entries would run ~20,000 DB queries. No Next.js body size limit is configured for this route. A malicious or accidental large file could cause OOM or exhaust DB write throughput.

**Change:** Add a `MAX_IMPORT_ENTRIES` constant (e.g., 500) in `config-import.ts`. At the top of `importConfigurationList()` and `importTemplateList()`, check `configs.length > MAX_IMPORT_ENTRIES` and push an error + return early. In the route handler, add a pre-parse file size check (e.g., `file.size > 5 * 1024 * 1024` rejects files > 5 MB).

**Benefit:** Prevents OOM from oversized imports and caps DB write burst to a bounded number of queries.

---

### #30: Unique constraint on Configuration.name

**Severity:** Low-Medium (Correctness)
**Area:** `prisma/schema.prisma:133` (`Configuration` model)

**Problem:** `Configuration.name` has no `@unique` constraint. The config import dedup logic uses `findFirst({ where: { name } })` to decide whether to update an existing entry or create a new one. Without uniqueness, two configs with the same name can coexist — `findFirst` returns whichever row SQLite happens to scan first (insertion-order dependent). This makes import idempotency unreliable: re-importing the same file may update a different config than intended, or never find the duplicate at all.

**Change:** Add `@unique` to `Configuration.name` in `prisma/schema.prisma`. Add a migration to create the unique index. Update `config-import.ts` to use `findUnique` instead of `findFirst` for name-based lookups.

**Benefit:** Guarantees import dedup determinism; prevents accidental name collisions from the config CRUD API.
