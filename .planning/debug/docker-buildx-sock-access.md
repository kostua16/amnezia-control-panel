---
status: resolved
trigger: "Docker Image workflow fails on Buildx setup because the selected runner cannot access /var/run/docker.sock"
created: 2026-06-12
updated: 2026-06-12
---

# Debug Session: Docker Buildx Socket Access

## Symptoms

- **Expected:** The Docker Image workflow validates PR builds and publishes from `main` without runner-level Docker permission failures or unsupported provenance features.
- **Actual:** PR runs `27385471965` and `27385738416` fail in `Set up Docker Buildx` before any image build starts. The first `main` publish run `27387434301` later reaches image push successfully, then fails in `Generate artifact attestation`.
- **Errors:**
  - `permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock`
  - `ERROR: failed to initialize builder ... permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`
  - `Failed to persist attestation: Feature not available for user-owned private repositories`
- **Timeline:** First observed on 2026-06-12 after PR #323 introduced `.github/workflows/docker-image.yml` and reproduced on its second PR run before the workflow merged to `main`.
- **Reproduction:** Trigger `.github/workflows/docker-image.yml` on a pull request; the `docker-build` job lands on `[self-hosted, big]` and fails during `docker/setup-buildx-action`.

## Evidence

- Failed PR run `27385471965` logged the socket permission error during `Docker Build / Set up Docker Buildx`.
- Failed PR run `27385738416` reproduced the same error on the same step after a follow-up commit.
- `main` now contains `.github/workflows/docker-image.yml` with `docker-build` and `publish` both pinned to `[self-hosted, big]`.
- The first post-merge push run `27387434301` spent multiple minutes queued on `Publish GHCR Image`, which is consistent with the workflow depending on a limited self-hosted runner pool.
- That same `main` run eventually reached `Generate artifact attestation` and failed with `Feature not available for user-owned private repositories`.

## Current Focus

- hypothesis: The workflow combines two incompatible assumptions for this repository: self-hosted Docker availability is inconsistent across runners, and GitHub artifact attestations are unsupported for user-owned private repositories.
- next_action: Monitor the follow-up GitHub Actions run after the runner migration lands.
- test: Re-run the Docker Image workflow on GitHub-hosted Ubuntu runners.
- expecting: Buildx starts cleanly, PR validation builds complete, main publish runs no longer wait on the self-hosted `big` pool, and attestation is skipped where GitHub does not support it.

## Eliminated

- PR Policy failure as the root cause; that was resolved by a conventional commit rename and passed on rerun.

## Resolution

root_cause: `.github/workflows/docker-image.yml` scheduled both `docker-build` and `publish` on `[self-hosted, big]`, but the observed runner pool could not access `/var/run/docker.sock` during `docker/setup-buildx-action` on PR validation runs. Even when a different self-hosted runner succeeded, the publish job still failed because `actions/attest` is not available for user-owned private repositories.

fix: Moved all Docker Image jobs to `ubuntu-24.04` so Buildx and Docker daemon access come from GitHub-hosted runners, added a guard that skips `actions/attest` for user-owned private repositories, and added regression coverage for both workflow invariants.

verification: `npm run lint`; `npm run format:check`; `node --test src/lib/__tests__/docker-image-workflow.test.ts`; `node .github/workflows/scripts/workflow-governance-check.cjs`; `/Users/kostua16/go/bin/actionlint .github/workflows/docker-image.yml`

files_changed:
- .github/workflows/docker-image.yml
- src/lib/__tests__/docker-image-workflow.test.ts
- .planning/debug/docker-buildx-sock-access.md
