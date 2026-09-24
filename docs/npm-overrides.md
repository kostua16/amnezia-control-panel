# npm Overrides Rationale

Each entry in `package.json` `overrides` is documented below with its reason,
origin commit, and when it can be safely removed.

| Package | Version | Reason | Origin | Removable when |
|---------|---------|--------|--------|-----------------|
| `ws` | `^8.21.0` | CVE — ws < 8.21.0 vulnerable | `cdfceb05` fix(deps): force ws >= 8.20.1 via npm overrides to resolve CVE | No longer pulled transitively |
| `@babel/core` | `^7.29.7` | Audit finding — monitored GitHub run flagged vulnerability | `38abdad0` fix(ci): address monitored GitHub run finding | No longer pulled transitively |
| `postcss` | `^8.5.12` | PostCSS XSS vulnerability | `20bf3dc3` fix(deps): resolve esbuild RCE + postcss XSS vulnerabilities | No longer pulled transitively |
| `nanoid` | `^3.3.17` | Audit finding — monitored GitHub run flagged nanoid vulnerability (transitive via postcss) | `6b36801c` fix(ci): address monitored GitHub run finding | No longer pulled transitively |
| `sharp` | `^0.35.0` | Known advisory in older sharp versions | `908ed206` fix: resolve #928 | No longer pulled transitively |
| `brace-expansion` | `5.0.8` (exact pin) | balanced-match ReDoS via brace-expansion@5 — **exact pin** because security pin, not feature dep | `698d4839` fix: resolve #973 (#974) | balanced-match removed from dep tree or upstream patches |
| `minimatch.brace-expansion` | `1.1.18` (exact pin) | balanced-match ReDoS via brace-expansion@1 (older transitive chain) — **exact pin** because security pin | `698d4839` fix: resolve #973 (#974) | minimatch/balanced-match removed from dep tree or upstream patches |
| `mysql2` | `^3.24.4` | GHSA auth-plugin downgrade to `mysql_clear_password` + zlib decompression-bomb DoS in `mysql2 <=3.23.0` (transitive via `prisma` CLI; app uses SQLite, so not reached at runtime) | fix(deps): resolve #952 | `prisma` ships `mysql2 >=3.24.x` |

## Notes

- **Exact pins** (`brace-expansion`, `minimatch.brace-expansion`) use exact versions instead of caret ranges to prevent future minor bumps from re-introducing the vulnerable transitive path.
- All other overrides use caret ranges (`^`) for compatibility with Dependabot's weekly bump workflow — these are transitive pins where the vulnerability was in a specific older version, not ongoing.
- New override entries should be documented here and flagged in PR review per the policy (see proposal pr974.3).
- `@hono/node-server` (`^1.19.13`, origin `20bf3dc3`) was removed from `overrides` earlier; verified 2026-08-15 that no `@hono/*` package appears anywhere in `package-lock.json` (the old esbuild-RCE chain is gone), so the row was retired from the table.

## Verification log

- **2026-08-15** (clean `npm ci`, branch `agent/ryan-mstoh2c8-deps-914`, closes #914): full `npm audit --json` and production-only `npm audit --omit=dev --json` both report `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`. `npm explain` evidence: `postcss@8.5.23` (GHSA-r28c-9q8g-f849 fixed; next@16.3.0 already wanted 8.5.23), `sharp@0.35.3` optional via next@16.3.0 (GHSA-f88m-g3jw-g9cj fixed), `js-yaml@5.2.3` direct (GHSA-pm4m-ph32-ghv5 fixed; the nested dev copy `@eslint/eslintrc → js-yaml@4.3.1` is outside every current advisory range per the same audit). The moderate chains from #914 are gone: `@hono/node-server` absent from the lock, and `valibot@1.4.2` (via `@prisma/dev@0.24.17`) is not flagged. No package or override changes were needed — the lock already satisfies every advisory.
- **2026-09-24** (branch `claude/funny-albattani-xyyibk`, #952): `npm audit` went from 1 critical / 8 high / 1 moderate to 1 high. `next` 16.3.0 → 16.3.6 fixes GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE, `<16.3.3`). `npm audit fix` refreshed `browserslist`, `baseline-browser-mapping`, `fast-uri`, `js-yaml`, `sharp`. `mysql2` override added (above). Remaining: `deepmerge-ts <8` via `prisma → @prisma/config` (stack exhaustion on recursive object graphs, only reachable through Prisma's own config loading); the fix is a semver-major bump that Prisma has to adopt upstream, so it's left open.
