---
quick_id: 261122-5wn
issue: 1149
status: complete
---

# Quick 261122-5wn Summary

PR Docker validation jobs no longer depend on the GitHub REST API.

## Changes

- `.github/workflows/docker-image.yml`
  - `docker-build` / `docker-build-stack`: removed `docker/metadata-action` (it calls the API and failed with
    `API rate limit exceeded for installation`); static local tags `validate-<sha>` / `stack-validate-<sha>`,
    no labels (both jobs use `push: false`).
  - `classify`: non-fatal `gh api rate_limit` step writes core/graphql remaining + reset to the step summary.
  - Publish jobs unchanged.

## Verification

- Prettier check on the workflow: pass.
- `docker-image workflow` unit test and the `docker-image.yml parses as YAML` workflow test: pass.
- `npm run test-only` (5 fail) and workflow e2e (11 fail) fail identically on `origin/main` without this change
  (workflow-triggers / CRLF regex checks on a Windows checkout with `core.autocrlf=true`); none concern
  `docker-image.yml`. Ubuntu CI is the authoritative run.

## Known residual risk

The publish jobs (`main` push, `v*` tag) still use `docker/metadata-action` because they need the real tag
set. A publish while the installation quota is exhausted can still fail at that step; recovery is a re-run
after the quota resets. The diagnostic step records the quota so this can be confirmed.

## Follow-up

Attribute which workflows consume the installation quota once the new diagnostic logs data. Related: #1059.
