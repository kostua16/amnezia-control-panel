---
name: kos-runner-disk-hygiene
description: Prevent GitHub-hosted runner disk-exhaustion failures (No space left on device) during zai workflow runs by keeping each job footprint small and using ensure-docker-disk-space for image jobs.
user-invocable: true
when_to_use: "When a workflow run failed with 'No space left on device', or when hardening a workflow that installs deps / pulls images on a GitHub-hosted runner."
category: utilities
argument-hint: "[workflow or run-id]"
keywords: [disk, space, no-space-left, runner, github-hosted, cache, prune, docker]
related: [kos-zai-run-failure-prevention, kos-gh-automation-tooling]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from audit-fix run 28097503249 (No space left on device), updated for GitHub-hosted runners (#1128)
  license: repo
  version: "2.0"
---

# Idea

All workflows run on GitHub-hosted `ubuntu-latest` runners. Every job starts on a fresh VM with roughly 14 GB of free disk, so disk never accumulates between runs; a `No space left on device` failure means the job's own footprint (dependencies, build output, Docker layers) is too large for one VM. The repo ships `ensure-docker-disk-space` as a cheap `df` guard before image jobs.

## When to invoke this skill directly

- A run failed with `No space left on device` / `ENOSPC` / cache-restore disk error.
- You are adding/editing a workflow that does `npm ci`, restores large caches, or pulls images.

## References

- `.github/actions/ensure-docker-disk-space/` — fail fast / free Docker storage before image jobs.
- `setup-environment` action — shared setup that runs first in most workflows; caches `node_modules`, `.next/cache`, and rtk through `actions/cache` (10 GB per repo, LRU eviction).
- `docs/runbooks/self-hosted-to-hosted-runners-rollback.md` — hosted vs self-hosted behavior differences and the way back to self-hosted runners.
- Symptom line shape: `##[error]No space left on device : '.../node_modules/...'`.

## Communication Style

Name the failing step, confirm it is disk (not OOM), then propose the smallest footprint reduction.

## Core Principles

YAGNI / KISS / DRY. Reduce what the job produces before adding cleanup steps. Do not hand-roll `rm -rf` of the workspace. There is no persistent runner state to prune.

## Your Approach

1. Confirm the error is disk (the path ends in `node_modules/...` or a cache/image dir), not memory.
2. Find the step that filled the disk (dependency install, build, image pull) in the job.
3. Trim it: narrower build context, fewer or smaller Docker layers, or skip unneeded installs.
4. Only if the footprint genuinely needs the space, add a step that removes preinstalled toolchains the job does not use (`/usr/local/lib/android`, `/usr/share/dotnet`, `/opt/ghc`).
5. Image jobs keep `ensure-docker-disk-space` before the build.

## Process Flow (Authoritative)

1. Grep the failed log for `No space left on device` / `ENOSPC`.
2. Identify the step that was running (usually install, build, or image pull).
3. Reduce that step's footprint, or free preinstalled toolchains before it.
4. Re-dispatch; if it recurs, treat it as a rollback trigger and read the runbook.

## Output Format

```text
DISK_FULL at <step>  =>  reduce <footprint> or free <toolchain dirs> before <step>
```

## Critical Constraints

- Free space **before** the step that needs it, not after.
- Do not delete caches blindly; `actions/cache` restores are what keep installs fast.
- Distinguish disk-exhaustion (this skill) from `turn_limit_hit`/rate-limit (other modes) — they look similar from the conclusion alone.
