# Phase 13.2 Verification: CI and supply-chain correctness

## Implemented

- Pinned external GitHub Actions references to immutable 40-character commit SHAs across `.github/workflows/*.yml` and `.github/actions/*/action.yml`.
- Added `.github/workflows/supply-chain.yml` for action pin checks, lockfile validation, and npm signature audit attempt.
- Updated `.github/dependabot.yml` for GitHub Actions grouping, labels, and conventional commit prefixes.
- Updated `ci.yml` so tests run independently from typecheck and added `Unsafe SQL Guard` for `$queryRawUnsafe` regression prevention.
- Preserved pinned GSD/RTK bootstrap settings in `setup-environment`.

## Evidence

- Ran `node .github/workflows/scripts/workflow-governance-check.cjs`.
- Result: `Errors: 0`, `Warnings: 0`.
- Secret search only found secret-context references such as `${{ secrets.GITHUB_TOKEN }}`, `${{ secrets.GH_PAT }}`, `${{ secrets.ZAI_API_KEY }}`, `${{ secrets.DEEPSEEK_API_KEY }}`, `${{ secrets.GEMINI_API_KEY }}`, and `${{ secrets.AV_API_KEY }}`; no hardcoded secret literals were introduced.

## Notes

- `npm audit signatures` is included as a non-blocking provenance signal because registry signature coverage can be incomplete.
- Phase plan `CONTEXT.md` was requested but no 13.2 context file exists in `.planning/phases/13.2-ci-supply-chain-correctness/`.
