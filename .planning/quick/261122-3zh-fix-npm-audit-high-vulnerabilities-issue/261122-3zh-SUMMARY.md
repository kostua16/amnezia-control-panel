---
quick_id: 261122-3zh
status: complete
issue: kostua16/amnezia-control-panel#1130
---

# Summary: fix `npm audit --audit-level=high` (#1130)

`npm audit` went from 22 advisories (1 critical, 13 high, 8 moderate) to 0.

| Commit | Change |
|--------|--------|
| `024ccf4` | `npm audit fix` (no --force): lockfile-only refresh (engine.io, sharp, source-map-js, zod, fast-uri, js-yaml, ...) |
| `ce2d798` | `next` and `eslint-config-next` 16.3.6 -> 16.4.6 (exact pins moved) |
| `548f0fb` | overrides: new `effect ^3.22.1` (`@prisma/config` pins 3.20.0 exactly); `brace-expansion` 5.0.8 -> 5.0.13; `minimatch.brace-expansion` 1.1.18 -> 1.1.22; `docs/npm-overrides.md` updated |

Next.js 16.3 -> 16.4 breaking changes (bundled docs, `upgrading/version-16.md`): only removal of
`experimental.appNewScrollHandler` (16.4.0); not used in this repo. No `--force` used. `typescript-eslint`/`eslint`
did not need a bump: the `minimatch` chain is fixed by the `brace-expansion` override bump.

## Verification (Windows, CRLF checkout)

- `npm audit --audit-level=high`: 0 vulnerabilities
- `npm run lint`: 0 errors (4 pre-existing warnings); `npm run typecheck`: pass; `npm run build:next`: pass
- `npm run test-only`: 866/871 pass; workflow tests: 1255/1266 pass. The 16 failures are the known Windows/CRLF
  categories (workflow YAML regex with `\r\n`, Prisma safe-SQL guard, upsertComment, formatDate, resource-monitor disk
  probe); none touch the changed dependencies. Linux CI is authoritative.
- `format:check` fails on 382 files locally due to CRLF; no `.ts/.tsx/.js/.cjs` files were changed.
