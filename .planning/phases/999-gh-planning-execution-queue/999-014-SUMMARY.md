---
plan: 999-014
phase: 999
status: complete
---

# Plan 999-014: Schema Hygiene — Migrations, Indexes, Enum Promotion

## Summary

Brought the Prisma schema fully in sync with migrations and modernized field types.

### What was done

1. **4 new Prisma enums** created: `GeoMatchType` (COUNTRY/REGION/SPECIAL), `GeoRuleSource` (CUSTOM/IMPORTED/TEMPLATE), `ChainTopology` (LINEAR/SPLIT/MESH), `RoutingTemplateCategory` (GEO/IP/DOMAIN/BUNDLE)
2. **6 string fields promoted** to enum types — `GeoRoutingRule.matchType`, `GeoRoutingRule.source`, `ChainPreset.topology`, `RoutingRuleTemplate.category` plus their Zod/API type mirrors
3. **7 performance indexes** added on frequently filtered columns: `User.isActive`, `User.isBlocked`, `Service.type`, `Service.status`, `UserProtocol.isActive`, `Configuration.isActive`
4. **7 models gained `updatedAt`** timestamps: Server, Service, RoutingRule, Alert, UserQuota, UserProtocol, Admin (ConfigTemplate and Configuration already had it; TrafficLog skipped as append-only)
5. **Migration SQL generated** (`20260617_schema_hygiene_indexes_enums_timestamps`) covering all drift from existing migrations — new tables for ConfigTemplate, GeoRoutingRule, RoutingRuleTemplate, ChainPreset, RemotePanel, PanelConnectionHistory, CachedPanelConfig; table redefinitions for updatedAt additions; all new indexes
6. **Application code updated** to use UPPERCASE enum values across route handlers, lib modules, types, and tests

### Files changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | 4 enums, 7 indexes, 7 updatedAt fields, 4 field type promotions |
| `prisma/migrations/20260617_schema_hygiene_indexes_enums_timestamps/migration.sql` | New migration (created) |
| `src/app/api/routing/geo/route.ts` | Enum values → UPPERCASE |
| `src/app/api/chain-presets/route.ts` | Zod enum → UPPERCASE |
| `src/lib/chain-presets.ts` | Topology values → UPPERCASE |
| `src/lib/routing-rule-templates.ts` | matchType/source/category → UPPERCASE |
| `src/types/chain-preset.ts` | Topology type → UPPERCASE |
| `src/lib/__tests__/chain-presets.test.ts` | Expected topology values → UPPERCASE |

### Verification

- `prisma validate` passes
- `tsc --noEmit`: 0 errors
- `eslint`: 0 issues on changed files
- `prettier`: all formatted
- `npm test`: 594 pass, 0 fail

## Self-Check: PASSED

- All acceptance criteria met
- No data loss migrations (all table redefinitions use INSERT INTO ... SELECT)
- TypeScript types are narrower (enum vs string)
- Existing functionality preserved

## Proposals deferred

- **Proposal 5 (Remove User.trafficQuotaBytes redundancy):** 30+ code references across API routes, UI components, hooks, and types. Removing requires migrating all read/write paths to `UserQuota` relation first. Deferred as stretch goal — current dual-source works correctly and removal is a breaking schema change with wide blast radius.
