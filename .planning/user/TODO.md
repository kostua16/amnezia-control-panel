# TODO — investigation tasks

Captured from the run-zai job health audit on 2026-06-27. Each task below is a follow-up
founded on observed run outcomes (15 runs/job sampled). Work them through a GSD workflow
(`/gsd-debug` is the natural fit) before editing workflow files.

---

## 1. Investigate `audit-fix` job cancellations — HIGH

`audit-fix.yml` (`Autonomous Audit-Fix`, cron `53 9,21 * * *`) — the run-zai job is being
killed on virtually every scheduled fire.

**Observed (15-run sample):** ⛔14 cancelled, ❌1 failure, ✅0 success. This is consistently
broken, not a one-off.

**Likely causes to rule in/out:**
- **Concurrency-group abort** — `group: ${{ github.workflow }}-${{ github.ref }}` means a newer
  scheduled run cancels an in-flight one. If runs are slow and the schedule overlaps, every run
  gets superseded.
- **Upstream gate never passes** — if run-zai is gated on an earlier step/job output (e.g.
  `has_fixable`) that never resolves true, the job may exit as cancelled rather than skipped.
- **Self-hosted runner contention / timeout** — `[self-hosted, big]` may be busy; check for
  runner timeouts or queue starvation.
- **The 1 failure** — pull its logs to see the actual error; it may reveal the cancellation root
  cause too.

**First step:** pick the most recent cancelled run, open its logs, and determine *who* cancelled
it (GitHub scheduler/concurrency, runner, or a step). The cancellation reason is usually logged
at the job level.

---

## 2. Investigate `suggest-improvements` cancellations — MEDIUM

`suggest-improvements.yml` (cron `11 0 * * *`) — mostly healthy but with recurring
cancellations.

**Observed (15-run sample):** ✅11, ⛔4 cancelled.

**Likely cause:** concurrency-group abort (`group: ${{ github.workflow }}-${{ github.ref }}`).
Because there's only one schedule per day, the more probable trigger is an overlapping
manual `workflow_dispatch` or a re-run superseding the scheduled one. Confirm whether the
cancelled runs coincide with a manual run on the same ref.

**First step:** list the cancelled run IDs and check each for a sibling run (same ref, started
within minutes) — that's the concurrency-abort signature.

---

## 3. Investigate `pr-improve` cancellations — MEDIUM

`pr-improve.yml` (`collect-targets` job) — similar pattern to suggest-improvements.

**Observed (15-run sample):** ✅12, ⛔3 cancelled.

**Likely cause:** same concurrency-group hypothesis. `pr-improve` is dispatch-triggered, so the
cancellations more likely come from a second dispatch for the same PR while the first is in
flight.

**First step:** confirm the cancelled runs share a PR number / ref with a concurrent run. If
confirmed benign, document it; if the aborted runs lost real work, consider widening the
concurrency group key (e.g. include the run attempt) or queueing instead of cancelling.

---

## General note on skipped (⏸) jobs

`claude`, `gsd-planning`, `issue-catch-up`, `triage`, and the `authorize` jobs of
`fix-issue` / `fix-review` / `rebase-pr` show all-⏸. This is **expected** — they are gate jobs
that only execute run-zai on the right trigger (e.g. a `/claude` or `/fix-issue` comment); off-
event runs skip. No investigation needed unless a real trigger comment is observed to be ignored.
