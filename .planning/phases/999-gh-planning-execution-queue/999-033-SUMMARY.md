---
plan: 999-033
phase: 999
status: complete
---

# Summary: SHA-named main build metrics artifacts

## What was done

Added comprehensive unit tests for the `build-metrics.cjs` workflow helper
that was already implemented in prior work. The implementation covered:
SHA-named artifact upload in `ci.yml` and baseline resolution in `perf-check.yml`.

## Changes

| File | Action |
|------|--------|
| `.github/workflows/scripts/__tests__/build-metrics.test.cjs` | Created — 34 unit tests |

## Test coverage

- `artifactNameForSha` — naming, input validation (3 tests)
- `getArtifactSha8` + `ARTIFACT_NAME_PATTERN` — extraction, pattern matching (3 tests)
- `buildMetricsPayload` — valid construction, required fields (3 tests)
- `validateMetricsPayload` — schema, metric type, sha/ref/size/duration validation, artifact name sha8 match, workflow sha match (12 tests)
- `selectExactArtifacts` — name + branch filtering, empty result (2 tests)
- `selectFallbackArtifacts` — newest-first sort, expired filtering, empty result (2 tests)
- `resolveBaselineFromArtifacts` — exact match priority, fallback to latest main, expired skip, invalid payload skip, load failure recording, missing baseline, non-function guard (7 tests)
- `writeMetricsFile` — file content and naming (1 test)

## Verification

- 34/34 new tests pass
- 154/154 workflow tests pass (includes new tests)
- 597/597 project tests pass
- Prettier: clean
- ESLint: clean

## No deferred proposals

All source artifact tasks were addressed:
1. Workflow helper — already existed
2. Tests — added
3. ci.yml SHA-named upload — already existed
4. perf-check.yml baseline resolution — already existed
5. Verify tests/lint/format — all clean
