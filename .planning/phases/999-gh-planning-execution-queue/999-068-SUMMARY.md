---
plan: 999-068
phase: 999
status: complete
---

# Summary: GHCR Docker Image Publishing Workflow (999-068)

## What was done

The source artifact specified 6 tasks for the GHCR Docker image publishing workflow. Investigation showed the workflow (`.github/workflows/docker-image.yml`) and README documentation were already substantially implemented in prior work. Two gaps were identified and closed:

1. **PR validate jobs wrote to Docker cache** — `docker-build` and `docker-build-stack` jobs (PR validation) had `cache-to` lines, making them write to the GHA cache on every PR. Removed `cache-to` from both validate jobs so PR builds are cache-read-only. Publish jobs retain `cache-to` with `ignore-error=true,timeout=5m` for non-blocking, time-limited cache exports.

2. **No branch protection recommendation** — Added a "Branch protection" subsection to README under Deploy with Docker, recommending the **Docker Build** and **Docker Build (Stack)** status checks be enabled in branch protection rules for `main`.

## Source artifact task mapping

| Task | Status | Notes |
|------|--------|-------|
| Add docker-image.yml with SHA-pinned actions, Buildx, GHCR, SBOM, provenance, attestation | Already done | File existed with full implementation |
| PR builds validation-only, publish from main/v\*.\*.\*/workflow_dispatch | Already done | Classify job handles ref-based routing |
| PR cache read-only, publish cache non-blocking, npm cache mount | Fixed + already done | Removed `cache-to` from validate jobs; npm cache mount in Dockerfile |
| Update README with GHCR pull/run examples | Already done | README had published image section with examples |
| Add Docker build check to branch protection recommendations | Added | New "Branch protection" subsection in README |
| Verify actionlint, workflow governance, formatting/lint/tests | Verified | npm test pass, 666 e2e tests pass, prettier clean |

## Changes

- `.github/workflows/docker-image.yml` — Removed `cache-to` from `docker-build` and `docker-build-stack` validate jobs (-2 lines)
- `README.md` — Added branch protection recommendation subsection (+4 lines)

## Verification

- `npm test` pass (typecheck, unit tests, lint 0 errors, prettier)
- Workflow e2e suite: 666/666 pass
- Prettier: clean

## Self-Check: PASSED
