# Fresh PR Workflow Plan

## Main idea

Keep the open PR queue fresh by adding an explicit freshness layer on top of the
existing PR flow. The freshness layer should inspect open PRs daily, categorize
them by age, review debt, changed-path compatibility, mergeability, and workflow
state, then feed two focused automation paths:

- `/rebase`: a maintainer-triggered AI-assisted rebase for one PR branch.
- `merge-pr`: a daily consolidation workflow for freshness-stale compatible PR
  groups.

The current `stale.yml` workflow remains a long-horizon cleanup policy. It
should not be shortened to solve the 1-7 day PR freshness problem.

```
open PRs
  |
  v
freshness scan
  |
  +-- fresh (<23h): watch, no consolidation
  |
  +-- freshness-stale (>23h), one PR needs branch refresh: /rebase
  |
  +-- freshness-stale (>23h), compatible group: merge-pr consolidation
  |
  +-- blocked by manual-only policy: report, do not auto-close
```

Read it like this: the scanner classifies and reports; `/rebase` fixes one PR in
place; `merge-pr` creates replacement PRs only for groups where consolidation is
safer than letting the backlog drift.

## Evidence snapshot

Snapshot time: `2026-06-23T21:44:04Z`.

The latest 50 open PRs were requested. The repository had only 14 open PRs, so
the latest 50 equals the full open backlog at that time. With `fresh_hours=23`,
the freshness cutoff was `2026-06-22T22:44:04Z`. PRs created before that cutoff
are freshness-stale; this is separate from the existing `stale.yml` policy,
which marks PRs stale after 60 days and closes 30 days later.

| PR | Age bucket | Class | State | Summary |
| --- | --- | --- | --- | --- |
| `#499` | fresh | GSD execution | `CLEAN`, manual-only | Batches server lookups in panel-sync push; already reached `flow/manual-only`. |
| `#498` | fresh | GSD execution | `UNSTABLE`, review-blocked | Architectural review follow-up with backend and database review debt. |
| `#497` | fresh | GSD execution | `UNSTABLE`, review-blocked | Architectural review follow-up with frontend, backend, test, and security review debt. |
| `#495` | fresh | GSD execution | `UNSTABLE`, review-blocked | Architectural review follow-up with frontend, backend, database, and test review debt. |
| `#489` | freshness-stale | GSD execution | `UNSTABLE`, checks pending | Adds optional `ADMIN_PASSWORD` seed fallback; security-sensitive backend/config review debt. |
| `#485` | freshness-stale | Dependabot | `UNSTABLE`, checks failed | Bumps ESLint `9.39.4` to `10.5.0`; major dependency review concern. |
| `#483` | freshness-stale | Dependabot | `UNSTABLE`, review-blocked | Bumps `js-yaml` `4.2.0` to `5.0.0`; `deps-review-manual`. |
| `#474` | freshness-stale | GSD execution | `CLEAN`, manual-only | Broadcaster throttling and traffic retention; dashboard payload review debt. |
| `#472` | freshness-stale | GSD execution, workflow | `CLEAN`, manual-only | Workflow fix; unresolved timeout review on `triage.yml`. |
| `#460` | freshness-stale | GSD execution | `CLEAN`, manual-only | VPN service adapter refactor; review debt around swallowed errors and registry truth. |
| `#459` | freshness-stale | GSD execution | `DIRTY`, review-blocked | Typed API client hooks; review debt around unwrapped response envelope. |
| `#444` | freshness-stale | GSD execution | `UNSTABLE`, checks failed | User creation/VPN consistency; review debt around retry semantics and alert resolution. |
| `#442` | freshness-stale | GSD execution | `UNSTABLE`, review-blocked | WireGuard key generation; review debt around preview/apply parity and private key handling. |
| `#439` | freshness-stale | GSD execution | `UNSTABLE`, review-blocked | Schema hygiene; review debt around data-loss migration and schema drift. |

## PR categories

### Fresh watch-only

PRs: `#499`, `#498`, `#497`, `#495`

These are younger than 23 hours. The freshness workflow should not consolidate
them yet. It may report their state and prepare them for future grouping, but it
must avoid noisy comments while they are still in the normal review window.

Rules:

- Do not consolidate fresh PRs.
- Do not close fresh PRs.
- Re-run the normal PR flow if labels/checks look stuck.
- Keep Dependabot PRs in a dependency-specific lane even when fresh.

### Security-sensitive backend/config group

PRs: `#489`

This PR is freshness-stale and touches admin credential seeding behavior. It is
not a dependency, workflow, or broad consolidation candidate. Treat it as a
single-PR review-debt item unless a later stale group touches the same seed,
auth, or config surface.

Rules:

- Keep credential seeding and auth/config changes separate from unrelated
  runtime application consolidation.
- Require source review findings to be preserved before any replacement PR is
  opened.
- Do not close the source PR while checks are pending or security review debt is
  unresolved.
- Prefer `/fix-review` or `/rebase` for in-place repair before considering a
  replacement PR.

### Workflow automation group

PRs: `#472`

This group contains `.github/**` workflow changes and an unresolved review
thread about raising turn budget without raising `timeout-minutes`.

Rules:

- Keep workflow PRs separate from app-code consolidation.
- Require `actionlint` and the workflow script e2e suite in any future
  implementation PR.
- Treat workflow PRs as high-conflict candidates because they can change the
  automation that is trying to consolidate them.
- `#472` is currently `CLEAN` and already reached `flow/manual-only`; report it
  as manual-only rather than rebase-needed unless its mergeability later becomes
  `DIRTY` or `CONFLICTING`.

### Dependency group

Current freshness-stale examples: `#485`, `#483`

Freshness-stale Dependabot PRs should be grouped separately from app-code and
workflow PRs. Both current examples edit `package.json` and
`package-lock.json`, but they are major updates with review concerns.
Consolidating two major dependency updates into one PR is allowed only when the
dependency review bundle explains why their combined upgrade surface is safer
than handling them separately.

Rules:

- Keep dependency groups separate from runtime application changes.
- Major updates default to manual review.
- Use the dependency-review signal as source evidence, not only Dependabot body
  text.
- If multiple dependency PRs touch the same lockfile section, prefer separate
  PRs unless `run-zai` can prove the combined lockfile diff is coherent and the
  validation gate is green.

### Dashboard and observability group

PRs: `#474`

This PR touches dashboard stats, real-time broadcaster code, WebSocket behavior,
and traffic log cleanup. Review debt is concentrated in payload correctness,
unused imports, startup cleanup handles, and batch deletion risk.

Rules:

- Keep this group separate from user/VPN provisioning changes.
- Consolidation must address review feedback, not just replay the source diff.
- Runtime validation should include tests for dashboard response shape and
  traffic cleanup behavior.

### VPN and user lifecycle group

PRs: `#460`, `#444`

Both PRs touch user provisioning, VPN service synchronization, or protocol
activation semantics. They are compatible by domain, but both have review debt
around error semantics and false success states.

Rules:

- Prefer one consolidation PR for this group if file conflicts are manageable.
- Carry forward unresolved review threads from both source PRs.
- Require tests around partial provisioning, failed protocol handling, and
  alert/visibility behavior.
- Avoid swallowing exceptions or converting provisioning failure into success.

### Routing, schema, and config generation group

PRs: `#442`, `#439`

Both PRs touch low-level correctness: generated WireGuard keys, config parity,
Prisma migration safety, schema drift, and routing rule creation behavior.

Rules:

- Split into two consolidation PRs if migration risk and key-generation risk
  make the combined diff too large.
- Never auto-close a migration PR source until the replacement includes a
  migration safety story.
- Require Prisma migration review and tests for config preview/apply parity.

### Frontend API client group

PRs: `#459`

This PR is large and conflicting. The central review issue is runtime response
shape mismatch caused by an API client unwrapping envelope data while callers
still expect full envelopes.

Rules:

- Prefer `/rebase` first because the branch is conflicting.
- Consolidate only if a later stale group also touches the same hook/API client
  migration surface.
- Require component-facing smoke coverage or hook tests for users, alerts,
  traffic stats, and dashboard stats.

## Freshness monitor design

Add a daily workflow, proposed name `fresh-prs.yml`, with `workflow_dispatch` for
manual dry runs.

Inputs:

- `dry_run`: default `true` for manual dispatch.
- `limit`: default `50`.
- `fresh_hours`: default `23`.
- `comment_mode`: `summary-only`, `changed-only`, or `artifact-only`; default
  `changed-only`.

Scheduled runs must not rely on `workflow_dispatch` input defaults. Resolve the
effective dry-run mode explicitly:

```bash
# Set FRESH_PRS_DRY_RUN_INPUT from `${{ inputs.dry_run }}` at the step env level
# so an explicit boolean false is preserved as the string "false".
if [ "$GITHUB_EVENT_NAME" = "schedule" ]; then
  effective_dry_run="${FRESH_PRS_SCHEDULE_DRY_RUN:-true}"
else
  effective_dry_run="${FRESH_PRS_DRY_RUN_INPUT:-true}"
fi
```

Initial rollout should keep `FRESH_PRS_SCHEDULE_DRY_RUN=true`. Switching the
scheduled scanner to mutation mode requires a later policy decision and a green
dry-run history.

Jobs:

1. `collect`
   - Checkout `main`.
   - Setup environment with `install-deps: false`.
   - Fetch open PR metadata through `gh pr list` and GraphQL review thread data.
   - Fetch changed files, mergeability, labels, author, draft state, head/base,
     and unresolved non-outdated review thread counts.

2. `classify`
   - Produce deterministic JSON with per-PR classifications and these buckets:
     - `fresh`
     - `freshness_stale`
     - `rebase_needed`
     - `review_debt`
     - `dependency`
     - `workflow`
     - `manual_only`
     - `consolidation_candidates`
   - The output file should be committed nowhere. Upload it as an artifact and
     render the same facts in the workflow summary.

3. `report`
   - Upsert one central repository issue titled `PR freshness report`.
   - Use sticky marker `<!-- fresh-prs-report -->`.
   - Also write the report to the workflow summary.
   - Avoid per-PR comments unless a PR newly becomes a consolidation candidate
     or newly becomes superseded.

4. `dispatch-merge-pr`
   - Optional future step after the plan is implemented.
   - Pass deterministic JSON to `merge-pr.yml` through an artifact or workflow
     dispatch input, not through natural-language parsing.

Output JSON shape:

```json
{
  "schema_version": 1,
  "generated_at": "2026-06-23T21:44:04Z",
  "fresh_hours": 23,
  "fresh_cutoff": "2026-06-22T22:44:04Z",
  "prs": [
    {
      "number": 472,
      "age_bucket": "freshness_stale",
      "merge_state": "CLEAN",
      "flow_state": "flow/manual-only",
      "recommended_action": "report-manual-only"
    }
  ],
  "groups": [
    {
      "id": "vpn-user-lifecycle",
      "title": "VPN and user lifecycle",
      "source_prs": [460, 444],
      "kind": "app-code",
      "risk": "high",
      "recommended_action": "consolidate-after-review-debt",
      "review_thread_count": 8
    }
  ]
}
```

## Current workflow changes needed

The planning docs should recommend these future implementation changes:

- Add report-only `fresh-prs.yml` first; mutation or dispatch to `merge-pr.yml`
  is a later rollout step.
- Add explicit schedule dry-run resolution with `FRESH_PRS_SCHEDULE_DRY_RUN`
  and preserve explicit `false` input values.
- Add `/rebase` trigger support to
  `.github/workflows/scripts/evaluate-trigger-policy.cjs`.
- Add tests for `/rebase` maintainer gating, bot rejection, non-PR comment
  rejection, and `workflow_dispatch`.
- Reuse or extend `.github/workflows/scripts/collect-review-feedback.cjs` for
  multi-PR feedback bundles.
- Add labels in `.github/workflows/policy.json`:
  - `fresh/stale`
  - `fresh/consolidation-candidate`
  - `fresh/superseded`
  - `stale-pr-consolidation`
- Do not apply `keep-open` from this workflow. Honor it as an existing
  operator-owned escape hatch if present.
- Keep `fix-review.yml` strict for direct human commands.
- Update `docs/workflow-e2e-scenarios.md` once actual workflow YAML and scripts
  are implemented, including cases for fresh watch-only, aged report-only,
  rebase-needed, dependency manual lane, workflow manual-only lane, and
  consolidation-candidate handoff.
- Keep `stale.yml` at its current long-horizon 60-day stale plus 30-day close
  policy.

## Safety defaults

- Initial `fresh-prs.yml` rollout is report-only.
- One consolidation PR per compatible group.
- Close source PRs only after the replacement PR is green, pushed, linked, and
  includes the source review findings.
- Do not mix workflow, dependency, and runtime app-code changes in one
  consolidation PR.
- Do not auto-close human-authored or fork PRs.
- Treat `flow/manual-only` as a completed PR-flow state that requires human
  merge, not as a failed state.
- Keep source PR closure owned by `merge-pr`; `fresh-prs` reports candidates and
  may hand off deterministic group JSON later.
- Do not delete source branches directly from `merge-pr`; let the existing
  branch cleanup workflow handle closed automation branches.
- Do not let `run-zai` approve, merge, close, comment, or push directly unless
  the workflow step owns that side effect.

## Acceptance criteria

- The freshness report can explain why every open PR is fresh, stale, blocked,
  rebase-needed, or consolidation-ready.
- The report is deterministic enough to be unit-tested from fixture JSON.
- Fresh PRs younger than 23 hours are not consolidated.
- Freshness-stale PR consolidation candidates preserve unresolved review
  feedback.
- Scheduled runs start in dry-run mode unless `FRESH_PRS_SCHEDULE_DRY_RUN` is
  explicitly set to `false`.
- The central `PR freshness report` issue is updated with marker
  `<!-- fresh-prs-report -->`; per-PR comments are reserved for candidate or
  superseded transitions.
- Existing `pr-flow.yml`, `pr-finalizer.yml`, `fix-review.yml`, and `stale.yml`
  semantics remain intact.
