---
quick_id: 260927-5bp
status: complete
type: execute
completed: 2026-09-27
commits:
  - ff8b144 fix(prisma): make migration 20260617 apply to non-empty SQLite tables
  - 251908d fix(prisma): add the missing migration for servers.redirectIp (not part of the branch that carries this summary; the same migration landed on main separately via PR #1238 as 28267566)
---

# Quick Task 260927-5bp: Fix migration 20260617 for non-empty SQLite tables (+ the missing `servers.redirectIp` migration)

`prisma migrate deploy` no longer aborts on a database that already holds rows, and the
migration chain now matches `schema.prisma` exactly. The local `prisma/dev.db` was rebuilt
from the corrected 10-migration chain with its four unique rows restored from the
pre-migration backup, admin bcrypt hash byte-identical.

## Root cause

SQLite rejects `ALTER TABLE … ADD COLUMN` with a **non-constant** default once the table
holds rows. Migration `20260617_schema_hygiene_indexes_enums_timestamps` added
`updatedAt` to `admins` and `user_quotas` with
`DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`, so:

- empty table → accepted (fresh CI / Docker databases, which is why nothing caught it)
- table with ≥1 row → `Cannot add a column with non-constant default` → Prisma **P3018**

Because `scripts/ensure-prisma-migrated.cjs` (used by `npm run dev` and `npm start`),
`docker-entrypoint.sh` and `docker/stack-entrypoint.sh` all run `migrate deploy` and abort
on failure, **any upgraded panel could not boot**. Reproduced deterministically on
SQLite 3.53.4 before the fix.

## What changed

### Task 1 — `20260617_schema_hygiene_indexes_enums_timestamps/migration.sql` (ff8b144)

Both `ALTER`s replaced, in place, with the table-redefine pattern the same file already
used for `alerts` / `routing_rules` / `servers` / `services` / `user_protocols`:

| Table | `updatedAt` seeded from | Index recreated | Notes |
| --- | --- | --- | --- |
| `admins` | `createdAt` | `admins_username_key` (UNIQUE) | credentials carried over by `INSERT … SELECT` |
| `user_quotas` | `CURRENT_TIMESTAMP` | `user_quotas_userId_key` (UNIQUE) | source table has **no** `createdAt`; `user_quotas_userId_fkey` → `users(id)` CASCADE carried over verbatim |

`updatedAt` is declared `DATETIME NOT NULL` with **no** DB default, matching
`@updatedAt` in `schema.prisma` (`model Admin` L68, `model UserQuota` L321) — the
`DEFAULT CURRENT_TIMESTAMP` in the old `ALTER`s was never in Prisma's own generated DDL
and would have created drift. Each block is wrapped in the file's existing
`PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF; … PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;` idiom (`defer_foreign_keys` is the one that works inside
Prisma's per-migration transaction). Diff: 1 file, 51 insertions, 8 deletions; the file's
CRLF worktree endings were preserved (274 CRLF, 0 bare LF).

Editing an already-shipped migration in place is survivable here: Prisma 7.10 does not
verify migration checksums in `migrate status` or `migrate deploy` (empirically probed),
and the migration was *unapplied and failed* on the only database that had it.
`prisma migrate dev` checksum behaviour was **not** tested and was not run.

### Task 2 — Second bug found by the drift gate (251908d)

> Landed separately: the `servers.redirectIp` migration reached `main` through PR #1238
> (`28267566`), so it is **not** part of the PR that carries this summary. The section is kept
> as the record of how the problem was found.

The plan's Task 2 gate ("stop if `migrate diff` emits SQL") fired on something unrelated
to the redefine blocks:

```sql
ALTER TABLE "servers" ADD COLUMN "redirectIp" TEXT;
```

`Server.redirectIp` was added to `schema.prisma` in **07d82cf (2026-08-15)** with **no
migration** — the last migration commit before this task was 0c71762 (2026-07-12). The
field is live code: `src/lib/config-generator.ts:64`, `src/app/api/servers/route.ts`,
`src/app/api/servers/[id]/config/route.ts`, `server-config.tsx`, `add-server-form.tsx`.
Prisma selects every scalar field, so any query on `Server` fails on a database built the
supported way. Local dev never noticed because `prisma/dev.db` came from `db push`.

Added `prisma/migrations/20260927000000_add_server_redirect_ip/migration.sql`. Nullable
with no default, so `ALTER TABLE` is accepted on a non-empty table. **User approved this
scope addition** before it was made; without it, rebuilding `dev.db` from the chain would
have broken the servers page locally too.

### Task 3 — Local `prisma/dev.db` rebuilt (no commit; gitignored)

The old `dev.db` could not be repaired by replaying: `_prisma_migrations` held `20260617…`
as `applied=no, rolled_back=no` (blocking everything after it), six tables the migration
would `CREATE` already existed, `whitelist_entries` was missing and
`panel_connection_history` was still present. Moved aside to
`prisma/dev.db.broken-20260927`, rebuilt via `migrate deploy`, then restored the unique
rows from `prisma/dev.db.backup-20260927`:

```
admins:          backup=1  inserted=1  (updatedAt seeded from createdAt)
users:           backup=1  inserted=1  (updatedAt copied)
user_protocols:  backup=2  inserted=2  (updatedAt seeded from CURRENT_TIMESTAMP)
```

Built-in seed data (`chain_presets`, `routing_rule_templates`, `geo_routing_rules`,
`config_templates`) was deliberately **not** restored — the app recreates it lazily
(`src/lib/chain-presets.ts`, `routing-rule-templates.ts`, `protocol-templates.ts`, all
upserting on `isBuiltIn: true`). The app was **not** started and `seedAdmin()` was **not**
invoked: `ADMIN_PASSWORD` is unset in `.env`, so a missing admin row would have been
silently recreated with the password `admin`.

## Verification

| Check | Result |
| --- | --- |
| Non-empty replay, all 10 migrations (`replay-nonempty.cjs`) | **PASS** — 19 assertions |
| …admin bcrypt hash | byte-identical to fixture |
| …`admins.updatedAt` | `= createdAt` (`2026-04-29 11:48:56`), `NOT NULL`, no DB default |
| …`user_quotas` / `user_protocols` rows | survived, `updatedAt` populated |
| …`servers` row | survived the redefine, `redirectIp` backfilled `NULL` |
| …`admins_username_key`, `user_quotas_userId_key` | present and UNIQUE |
| …`user_quotas_userId_fkey` | present, `on_delete = CASCADE` |
| **Negative control** — same script against the pre-fix file (`git checkout HEAD~1`) | **fails at `20260617…`: `Cannot add a column with non-constant default`** |
| Tree restored after negative control | `git status --porcelain` clean, `git stash list` empty |
| Fresh DB, `prisma migrate deploy` | 10 migrations found, all applied |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (fresh DB) | `-- This is an empty migration.` (zero drift) |
| `prisma migrate status` (rebuilt `dev.db`) | `Database schema is up to date!` |
| `prisma migrate diff` (rebuilt `dev.db`) | zero drift |
| Restored rows readback + `PRAGMA foreign_key_check` | counts match backup, 0 FK violations |

The negative control is what proves the test detects the bug rather than passing vacuously
— an empty table accepts the broken `ALTER` too, so fixtures must be inserted *after* the
pre-`20260617` migrations and *before* it.

## Notes / follow-ups

- **On disk, gitignored, safe to delete once you are satisfied:**
  `prisma/dev.db.backup-20260927` (the only copy of the original admin hash — keep until
  you have logged in successfully), `prisma/dev.db.broken-20260927`,
  `prisma/dev.db-wal.broken-20260927`, `prisma/dev.db-shm.broken-20260927`.
- Scratch verification scripts were deleted per the plan (`.qwen/tmp/verify/`,
  `dbcheck*.cjs`, `alter-test.cjs`, `.qwen/tmp/fresh/`, `alter-*.db`). The non-empty
  migration replay is a good candidate for a permanent regression test under
  `npm run test-only` — not added here, out of scope.
- Pre-existing, unrelated, **not** touched: the 5 Windows-only test failures and the
  324-file `format:check` fallout, both caused by CRLF worktree endings and
  `process.platform === 'win32'` branches. The `.gitattributes` (`* text=auto eol=lf`)
  fix plus worktree renormalization is still pending as its own quick task.
- GSD infrastructure observation: the project-local `.claude/agents/gsd-planner.md` and
  `gsd-executor.md` are **phase-only** — they begin with
  `gsd-tools query init.plan-phase "${PHASE}"` / `init.execute-phase "${PHASE}"` and have
  no quick-mode branch. For a quick id both return `phase_found: false`, `plans: []`, so
  neither subagent can execute a `/gsd-quick` task even though
  `gsd-core/workflows/quick.md` Step 5/6 spawns them with `Mode: quick`. This task was
  therefore planned and executed inline by the orchestrator; all quick-mode artifacts
  (PLAN.md, SUMMARY.md, STATE.md row, atomic code commits, separate docs commit) are
  present as the workflow requires.
- Nothing was pushed. `main` is ahead of `origin/main` by 3 commits
  (`1156796`, `ff8b144`, `251908d`).
