---
status: complete
date: 2026-06-11
---

# Summary

Added a GHCR Docker image workflow that validates Docker builds on pull requests and publishes `ghcr.io/kostua16/amnezia-control-panel` from `main`, version tags, and matching manual dispatch refs. The workflow uses SHA-pinned actions, scoped publish permissions, Buildx, Docker metadata tags/labels, amd64 builds, GitHub Actions cache, SBOM/provenance, and a pushed artifact attestation.

Hardened Docker layer caching for the 3-runner self-hosted setup: PR/manual validation refs only read the shared BuildKit cache, trusted publish runs export cache with `ignore-error=true` and `timeout=5m`, and the Dockerfile uses a BuildKit npm cache mount for dependency installs.

Updated Docker deployment docs with GHCR pull/run examples and added the Docker build check to branch protection recommendations.

## Verification

- `/Users/kostua16/go/bin/actionlint .github/workflows/docker-image.yml`
- `node .github/workflows/scripts/workflow-governance-check.cjs`
- `npm run lint`
- `npm run format:check`
- `prettier --check .github/workflows/docker-image.yml README.md .github/branch-protection-recommendations.md .planning/STATE.md .planning/quick/260612-1up-implement-ghcr-docker-image-publishing-w/260612-1up-PLAN.md .planning/quick/260612-1up-implement-ghcr-docker-image-publishing-w/260612-1up-SUMMARY.md`
- `npx prisma generate`
- `npm test`
- `docker build --platform linux/amd64 -t amnezia-control-panel:local .`
- second `docker build --platform linux/amd64 -t amnezia-control-panel:local .` to confirm cached layers are reused
- `graphify update .`

Note: the first `npm test` attempt failed because `src/generated/prisma` was absent in this worktree. After running `npx prisma generate`, the full test suite passed.
