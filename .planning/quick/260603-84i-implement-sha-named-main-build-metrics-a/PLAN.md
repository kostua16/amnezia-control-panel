---
status: in_progress
date: 2026-06-03
---

# Implement SHA-named main build metrics artifacts

## Goal

Store `main` build metrics as `build-metrics-{sha8}.json` artifacts from CI and let PR performance checks read that baseline instead of rebuilding `main`.

## Tasks

- Add a workflow helper for artifact selection, validation, download, and GitHub output writing.
- Add tests for exact-SHA lookup, fallback lookup, invalid/expired artifacts, and missing baseline behavior.
- Update `ci.yml` to upload SHA-named build metrics artifacts for successful `main` push builds.
- Update `perf-check.yml` to use the stored baseline, keep existing warning thresholds, and skip comparison when unavailable.
- Verify tests, lint, Prettier, actionlint, and diff checks.
