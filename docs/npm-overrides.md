# npm Overrides Rationale

Each entry in `package.json` `overrides` is documented below with its reason,
origin commit, and when it can be safely removed.

| Package | Version | Reason | Origin | Removable when |
|---------|---------|--------|--------|-----------------|
| `ws` | `^8.21.0` | CVE — ws < 8.21.0 vulnerable | `cdfceb05` fix(deps): force ws >= 8.20.1 via npm overrides to resolve CVE | No longer pulled transitively |
| `@babel/core` | `^7.29.7` | Audit finding — monitored GitHub run flagged vulnerability | `38abdad0` fix(ci): address monitored GitHub run finding | No longer pulled transitively |
| `@hono/node-server` | `^1.19.13` | esbuild RCE chain — require patched server adapter | `20bf3dc3` fix(deps): resolve esbuild RCE + postcss XSS vulnerabilities | No longer pulled transitively |
| `postcss` | `^8.5.12` | PostCSS XSS vulnerability | `20bf3dc3` fix(deps): resolve esbuild RCE + postcss XSS vulnerabilities | No longer pulled transitively |
| `nanoid` | `^3.3.17` | Audit finding — monitored GitHub run flagged nanoid vulnerability (transitive via postcss) | `6b36801c` fix(ci): address monitored GitHub run finding | No longer pulled transitively |
| `sharp` | `^0.35.0` | Known advisory in older sharp versions | `908ed206` fix: resolve #928 | No longer pulled transitively |
| `brace-expansion` | `5.0.8` (exact pin) | balanced-match ReDoS via brace-expansion@5 — **exact pin** because security pin, not feature dep | `698d4839` fix: resolve #973 (#974) | balanced-match removed from dep tree or upstream patches |
| `minimatch.brace-expansion` | `1.1.18` (exact pin) | balanced-match ReDoS via brace-expansion@1 (older transitive chain) — **exact pin** because security pin | `698d4839` fix: resolve #973 (#974) | minimatch/balanced-match removed from dep tree or upstream patches |

## Notes

- **Exact pins** (`brace-expansion`, `minimatch.brace-expansion`) use exact versions instead of caret ranges to prevent future minor bumps from re-introducing the vulnerable transitive path.
- All other overrides use caret ranges (`^`) for compatibility with Dependabot's weekly bump workflow — these are transitive pins where the vulnerability was in a specific older version, not ongoing.
- New override entries should be documented here and flagged in PR review per the policy (see proposal pr974.3).
