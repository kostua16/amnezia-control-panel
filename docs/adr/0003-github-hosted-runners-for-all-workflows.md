# ADR 0003: GitHub-hosted runners for all workflows

- **Date:** 2026-11-22
- **Status:** Accepted
- **Tracking:** #1128 (RUN-M01)

## Context

Every workflow in `.github/workflows/` ran on a self-hosted pool: 62 jobs on
`self-hosted` and 36 jobs on `[self-hosted, big]` (only 11 jobs used
`ubuntu-latest`). The repository is public, so GitHub-hosted minutes are free.

No self-hosted runner is registered any more (`gh api repos/{owner}/{repo}/actions/runners`
returns an empty list). Every self-hosted job therefore stays queued forever and
the whole automation stack (CI, PR flow, review, audit, monitor) is stalled.

The self-hosted design also carried its own tooling and incident history:

- a disk-pruning step and repo-local cache (`maxnowack/local-cache`) in
  `setup-environment`, added after `No space left on device` failures on the
  persistent host;
- `cleanup-runner.yml`, a monitor self-heal step, and `runner-health-check.cjs`
  to detect pool saturation and disk pressure;
- a design assumption of at least two runners, because one runner serialized the
  four required CI jobs.

## Decision

- **D-01:** Every job runs on plain `ubuntu-latest`. Both `self-hosted` and
  `[self-hosted, big]` are replaced; no paid larger runners are used.
- **D-02:** Tooling that only made sense for a persistent host is deleted:
  `debug-auth-probe.yml`, `cleanup-runner.yml`, `runner-health-check.cjs` and its
  test, the `ensure-disk-space` action, the monitor disk self-heal step, the
  maintenance runner-health item, and the actionlint `big` label.
  `setup-environment` becomes hosted-native (SHA-pinned `actions/cache`, no disk
  pruning) and provisions a checksum-verified `actionlint` on request, because
  `ubuntu-latest` does not preinstall it. A rollback runbook is written from the
  real diff against the pre-migration commit.
- **D-03:** The whole change lands in one pull request (three commits: workflows,
  `setup-environment`, docs).

Kept on purpose: `ensure-docker-disk-space` (a cheap `df` guard before image
jobs on the ~14 GB hosted disk) and the monitor's queue-latency telemetry
(hosted runners still queue when the concurrent-job cap is reached).

## Consequences

- Jobs start immediately instead of queueing for a missing runner, and each job
  gets a fresh VM, so there is no residue between runs.
- GitHub's concurrent-job cap (20 on the Free plan) replaces the runner-count
  bottleneck; the CI fan-out no longer serializes.
- Dependency and build caches move to `actions/cache` (10 GB per repository, LRU
  and 7-day eviction, branch-scoped). Cold caches cost a longer first run.
- Free minutes depend on the repository staying public. Making it private makes
  minutes billable and is a rollback trigger.
- A job must fit the ~14 GB hosted disk and the 6 hour job limit.
- Guard test `src/lib/__tests__/workflow-github-hosted-runners.test.ts` fails if
  any `runs-on` value is not `ubuntu-latest`; a partial rollback must relax it
  deliberately.

## Alternatives rejected:

- **Paid larger GitHub-hosted runners** for the old `big` jobs. Adds recurring
  cost for a public repository whose heavy jobs already fit a standard runner.
- **Keep the self-hosted pool.** Requires re-registering and maintaining at least
  two hosts (disk hygiene, health checks, security approval for fork PRs on a
  public repository) with no benefit while jobs fit hosted runners.
- **Hybrid with heavy jobs on `[self-hosted, big]`.** Keeps all of the
  host-maintenance burden for a handful of jobs and keeps the failure mode
  (a missing runner stalls those jobs) in place.

## Rollback

See [`docs/runbooks/self-hosted-to-hosted-runners-rollback.md`](../runbooks/self-hosted-to-hosted-runners-rollback.md)
for the full and partial rollback procedure, the file inventory, and the
runner re-registration steps.
