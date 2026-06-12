---
status: resolved
trigger: "Docker Image workflow failed on Buildx setup, then failed on unsupported attestations in a user-owned private repository"
created: 2026-06-12
updated: 2026-06-12
---

# Debug Session: Docker Image Workflow Compatibility

## Symptoms

- **Expected:** The Docker Image workflow validates PR builds and publishes from `main` while staying on the repo's self-hosted runners and without unsupported provenance features.
- **Actual:** Earlier PR runs `27385471965` and `27385738416` failed in `Set up Docker Buildx` before any image build started. After the runner image was fixed, the first `main` publish run `27387434301` reached image push successfully, then failed in `Generate artifact attestation`.
- **Errors:**
  - `permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock`
  - `ERROR: failed to initialize builder ... permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`
  - `Failed to persist attestation: Feature not available for user-owned private repositories`
- **Timeline:** First observed on 2026-06-12 after PR #323 introduced `.github/workflows/docker-image.yml`. The Docker socket issue was later fixed in the self-hosted runner image, leaving attestation support as the remaining deterministic failure on `main`.
- **Reproduction:** Trigger `.github/workflows/docker-image.yml` on `main` in this user-owned private repository; the publish job reaches `Generate artifact attestation` and GitHub rejects the feature.

## Evidence

- Earlier PR runs `27385471965` and `27385738416` logged the Docker socket permission error during `Docker Build / Set up Docker Buildx`.
- The self-hosted runner image has since been fixed to provide Docker socket access, so those failures are no longer treated as a workflow-level defect.
- `main` contains `.github/workflows/docker-image.yml` with Docker jobs intentionally pinned to `self-hosted` and `[self-hosted, big]`.
- `main` run `27387434301` reached `Generate artifact attestation` and failed with `Feature not available for user-owned private repositories`, proving the remaining defect is GitHub feature incompatibility rather than runner selection.

## Current Focus

- hypothesis: The workflow should stay on self-hosted runners, and the only remaining compatibility defect is that GitHub artifact attestations are unsupported for user-owned private repositories.
- next_action: Re-run the Docker Image workflow after restoring the self-hosted labels and keeping only the attestation guard.
- test: Re-run the PR Docker Image workflow on the fixed self-hosted runner image.
- expecting: Buildx starts cleanly on self-hosted runners, PR validation completes, and publish skips attestation where GitHub does not support it.

## Eliminated

- PR Policy failure as the root cause; that was resolved by a conventional commit rename and passed on rerun.

## Resolution

root_cause: The remaining workflow defect is that `actions/attest` is not available for user-owned private repositories. The earlier Docker socket failure was runner-image specific and has since been fixed outside the workflow.

fix: Restored the intended self-hosted runner labels, kept a guard that skips `actions/attest` for user-owned private repositories, and updated regression coverage so it enforces self-hosted runner usage plus the attestation skip.

verification: `npm run lint`; `npm run format:check`; `node --test src/lib/__tests__/docker-image-workflow.test.ts`; `node .github/workflows/scripts/workflow-governance-check.cjs`; `/Users/kostua16/go/bin/actionlint .github/workflows/docker-image.yml`

files_changed:
- .github/workflows/docker-image.yml
- src/lib/__tests__/docker-image-workflow.test.ts
- .planning/debug/docker-buildx-sock-access.md
