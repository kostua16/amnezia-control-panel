# Context — GitHub Workflow Automation

Glossary for the workflow-automation sub-system. Implementation-free; sharpens overloaded terms so scenario specs are unambiguous. Co-located with `documentation.md`.

## Terms

- **Required check** — OVERLOADED, two distinct meanings:
  1. _GitHub branch-protection required checks_ — repo settings; only `pr-flow/ready` is required here.
  2. _pr-finalizer filtered checks_ — the checks `pr-finalizer.yml` reads and buckets via `required-check-evidence.cjs` to decide `pr-flow/ready`. NOT the GitHub list.
     → In e2e scenarios, "required check" means **(2)** unless stated. (The P0-1 path-filter risk hinges on this distinction.)
- **Freshness-stale PR** — a PR older than the freshness scanner's short
  review window (currently 23 hours). This is not the same as the long-horizon
  `stale.yml` cleanup state, which marks inactive PRs after 60 days and closes
  them 30 days later.
- **pr-flow/ready** — the single commit-status context that gates merge; set by `pr-finalizer.yml`. Passing = merge-eligible (still subject to manual-only/blocker labels).
- **flow/\* label** — pr-flow state labels (`flow/draft`, `flow/needs-review`, `flow/manual-only`, …) synced by `pr-flow.yml` from `.github/pr-flow.json`.
- **Review signal label** — `*-review-passed` / `*-review-concerns` produced by AI-review workflows; consumed by pr-finalizer as `required_pass_labels`.
- **Automation PR** — PR opened by an autonomous agent on a trusted branch prefix (`claude-auto-fix-ci-`, `claude-planning-pr-`, …); governed by `policy.json trustedAutomationBranchPrefixes`.
- **wake / prt** — pr-flow concurrency event classes: `wake` = reactive
  (`workflow_run` / `issue_comment` / `workflow_dispatch`), `prt` =
  `pull_request_target` orchestrate. See [[e2e-cancellation-cascade]].
- **Characterization test** — locks CURRENT behavior as a green regression baseline; no judgment of correctness.
- **Spec test** — asserts an INTENDED invariant; may be red today and drives a fix (TDD red→green).

## See also

- `documentation.md` — workflow configuration reference (authoritative flow spec)
- `docs/gh-workflows-architecture-review.md` — architecture review + P0/P1/P2 backlog
- `docs/workflow-e2e-scenarios.md` — (planned) exhaustive e2e scenario catalog + Mermaid
