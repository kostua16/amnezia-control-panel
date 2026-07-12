# Architectural Review Pass 14 (2026-07-12)

Source: `/gsd:explore` deep architectural review.
Deduped against: proposals #1-#37 and open PRs (#673, #666, #684, #685, #686).

## Proposal 38: ConfigTemplate missing `@unique` on `name`

**Severity:** Medium (Correctness)
**Area:** `prisma/schema.prisma:147`, `src/lib/config-import.ts:184`

### Problem

`ConfigTemplate` has no `@unique` constraint on `name`. The import function at `config-import.ts:184` uses `findFirst` (not `findUnique`) to check for existing templates. This means:

1. Duplicate template names can accumulate in the database — each import creates a new row if timing is unlucky.
2. Import idempotency is unreliable — "skip if unchanged" depends on `findFirst` returning the one the admin expects, but with duplicates it may match any copy.
3. Unlike `Configuration.name` (which already has `@unique` per proposal #30 — implemented), `ConfigTemplate` was never hardened.

### Evidence

```
prisma/schema.prisma:147 — ConfigTemplate model, no @unique on name field
config-import.ts:184       — prisma.configTemplate.findFirst({ where: { name } })
```

### Fix

1. Add `@unique` to `ConfigTemplate.name` in `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name config-template-unique-name`.
3. Change `findFirst` to `findUnique` in `config-import.ts:184`.
4. Handle the migration: if duplicate names exist, deduplicate before applying the constraint (keep newest, merge usage counts).

### Benefit

Import idempotency guaranteed at the DB level. No silent duplicate accumulation.

---

## Proposal 39: Config import N+1 sequential queries

**Severity:** Medium (Perf)
**Area:** `src/lib/config-import.ts:53-133`, `src/lib/config-import.ts:137-236`

### Problem

Both `importConfigurationList` and `importTemplateList` loop through each entry individually:

1. `findUnique` (or `findFirst`) to check if the entry exists.
2. `create` or `update` based on existence.

With `MAX_IMPORT_ENTRIES = 500`, worst case is 1000 sequential DB round-trips (500 checks + 500 writes). SQLite handles this but the latency compounds — each query adds ~1-5ms, totaling 0.5-5 seconds for a full import.

### Evidence

```
config-import.ts:92  — prisma.configuration.findUnique({ where: { name } })  (inside for loop)
config-import.ts:103 — prisma.configuration.update(...)  (inside for loop)
config-import.ts:116 — prisma.configuration.create(...)  (inside for loop)
config-import.ts:184 — prisma.configTemplate.findFirst({ where: { name } })  (inside for loop)
```

### Fix

1. **Pre-load existing entries:** One `findMany` to fetch all existing names (and their content hashes) into a `Map`.
2. **Classify entries:** Iterate the import payload once, classifying each as `new`, `changed`, or `unchanged` against the map.
3. **Batch-create new entries:** Use `createMany` (Prisma supports this for SQLite) for all new entries in one query.
4. **Individual updates for changed:** Only entries that actually changed need individual `update` calls — typically a small fraction of imports.

### Benefit

Reduces 1000 sequential queries to ~3 (one findMany + one createMany + N updates for changed only). Import latency drops from seconds to milliseconds for typical payloads.

---

## Proposal 40: No `loading.tsx` files in App Router

**Severity:** Low-Medium (UX)
**Area:** `src/app/(dashboard)/**/loading.tsx` (new)

### Problem

Zero `loading.tsx` files exist anywhere in `src/app/`. Next.js App Router uses `loading.tsx` as the Suspense boundary for route segments — when a user navigates between dashboard pages, the previous content disappears immediately and nothing renders until the new page's data resolves. This creates a visible blank flash on every navigation.

### Evidence

```
$ find src/app -name 'loading.tsx'  →  (empty)
$ grep -r 'Suspense' src/components/**/*.tsx →  (no matches)
$ grep -r 'loading' src/app/(dashboard) →  (no loading.tsx files)
```

The `ErrorBoundary` component exists at `src/components/layout/error-boundary.tsx` and wraps dashboard children — but there is no corresponding loading boundary.

### Fix

Add `loading.tsx` files to each dashboard segment route with skeleton UI matching the page's structure:

1. `src/app/(dashboard)/dashboard/loading.tsx` — stat cards + chart skeletons.
2. `src/app/(dashboard)/users/loading.tsx` — user table row skeletons.
3. `src/app/(dashboard)/servers/loading.tsx` — server card skeletons.
4. `src/app/(dashboard)/services/loading.tsx` — service status skeletons.
5. `src/app/(dashboard)/panels/loading.tsx` — panel list skeletons.
6. `src/app/(dashboard)/config/loading.tsx` — config list skeletons.
7. `src/app/(dashboard)/monitoring/loading.tsx` — resource card skeletons.
8. `src/app/(dashboard)/chains/loading.tsx` — chain list skeletons.
9. `src/app/(dashboard)/routing/loading.tsx` — rules table skeletons.
10. `src/app/(dashboard)/templates/loading.tsx` — template grid skeletons.

Each file exports a default component rendering skeleton divs with `animate-pulse`. The existing `Skeleton` component from shadcn/ui (`src/components/ui/skeleton.tsx`) can be reused.

### Benefit

Instant visual feedback on every route transition. No blank flash. Standard Next.js UX pattern.
