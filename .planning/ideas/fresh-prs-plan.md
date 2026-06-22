# Fresh PR Workflow Plan

## Main idea

Keep the open PR queue fresh by adding an explicit freshness layer on top of the
existing PR flow. The freshness layer should inspect open PRs daily, categorize
them by age, review debt, changed-path compatibility, mergeability, and workflow
state, then feed two focused automation paths:

- `/rebase`: a maintainer-triggered AI-assisted rebase for one PR branch.
- `merge-pr`: a daily consolidation workflow for stale compatible PR groups.

The current stale workflow remains a long-horizon cleanup policy. It should not
be shortened to solve the 1-7 day PR freshness problem.

```
open PRs
  |
  v
freshness scan
  |
  +-- fresh (<23h): watch, no consolidation
  |
  +-- stale (>23h), one PR needs branch refresh: /rebase
  |
  +-- stale (>23h), compatible group: merge-pr consolidation
  |
  +-- blocked by human-only policy: report, do not auto-close
```

Read it like this: the scanner classifies and reports; `/rebase` fixes one PR in
place; `merge-pr` creates replacement PRs only for groups where consolidation is
safer than letting the backlog drift.

## Evidence snapshot

Snapshot time: `2026-06-22T23:06:55Z`.

The latest 50 open PRs were requested. The repository had only 10 open PRs, so
the latest 50 equals the full open backlog at that time.

| PR | Age bucket | Class | State | Summary |
| --- | --- | --- | --- | --- |
| `#489` | fresh | GSD execution | mergeable, checks pending | Adds optional `ADMIN_PASSWORD` seed fallback; has security review debt. |
| `#485` | fresh | Dependabot | mergeable, checks failed | Bumps ESLint `9.39.4` to `10.5.0`; major dependency review concern. |
| `#483` | fresh | Dependabot | mergeable, review-blocked | Bumps `js-yaml` `4.2.0` to `5.0.0`; major dependency review concern. |
| `#474` | stale | GSD execution | mergeable, review-blocked | Broadcaster throttling and traffic retention; dashboard payload review debt. |
| `#472` | stale | GSD execution, workflow | conflicting, manual-only | Workflow fix; unresolved timeout review on `triage.yml`. |
| `#460` | stale | GSD execution | mergeable, manual-only | VPN service adapter refactor; review debt around swallowed errors and registry truth. |
| `#459` | stale | GSD execution | conflicting, review-blocked | Typed API client hooks; review debt around unwrapped response envelope. |
| `#444` | stale | GSD execution | mergeable, checks failed | User creation/VPN consistency; review debt around retry semantics and alert resolution. |
| `#442` | stale | GSD execution | mergeable, review-blocked | WireGuard key generation; review debt around preview/apply parity and private key handling. |
| `#439` | stale | GSD execution | mergeable, review-blocked | Schema hygiene; review debt around data-loss migration and schema drift. |

## PR categories

### Fresh watch-only

PRs: `#489`, `#485`, `#483`

These are younger than 23 hours. The freshness workflow should not consolidate
them yet. It may report their state and prepare them for future grouping, but it
must avoid noisy comments while they are still in the normal review window.

Rules:

- Do not consolidate fresh PRs.
- Do not close fresh PRs.
- Re-run the normal PR flow if labels/checks look stuck.
- Keep Dependabot PRs in a dependency-specific lane even when fresh.

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
- Prefer `/rebase` first when mergeability is `CONFLICTING`.

### Dependency group

Current fresh examples: `#485`, `#483`

Future stale Dependabot PRs should be grouped separately from app-code and
workflow PRs. Both example PRs edit `package.json` and `package-lock.json`, but
they are major updates with review concerns. Consolidating two major dependency
updates into one PR is allowed only when the dependency review bundle explains
why their combined upgrade surface is safer than handling them separately.

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

- `dry_run`: default `true` for manual dispatch and `false` for scheduled runs.
- `limit`: default `50`.
- `fresh_hours`: default `23`.
- `comment_mode`: `summary-only`, `changed-only`, or `artifact-only`; default
  `changed-only`.

Jobs:

1. `collect`
   - Checkout `main`.
   - Setup environment with `install-deps: false`.
   - Fetch open PR metadata through `gh pr list` and GraphQL review thread data.
   - Fetch changed files, mergeability, labels, author, draft state, head/base,
     and unresolved non-outdated review thread counts.

2. `classify`
   - Produce deterministic JSON with these buckets:
     - `fresh`
     - `stale`
     - `rebase_needed`
     - `review_debt`
     - `dependency`
     - `workflow`
     - `manual_only`
     - `consolidation_candidates`
   - The output file should be committed nowhere. Upload as an artifact and
     optionally attach a concise sticky summary comment.

3. `report`
   - Upsert one summary issue comment or a repository issue titled
     `PR freshness report`.
   - Avoid per-PR comments unless a PR newly becomes a consolidation candidate
     or newly becomes superseded.

4. `dispatch-merge-pr`
   - Optional future step after the plan is implemented.
   - Pass deterministic JSON to `merge-pr.yml` through an artifact or workflow
     dispatch input, not through natural-language parsing.

Output JSON shape:

```json
{
  "generated_at": "2026-06-22T23:06:55Z",
  "fresh_hours": 23,
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
- Keep `fix-review.yml` strict for direct human commands.
- Update `docs/workflow-e2e-scenarios.md` once actual workflow YAML and scripts
  are implemented.
- Keep `stale.yml` at its current long-horizon 60-day stale plus 30-day close
  policy.

## Safety defaults

- One consolidation PR per compatible group.
- Close source PRs only after the replacement PR is green, pushed, linked, and
  includes the source review findings.
- Do not mix workflow, dependency, and runtime app-code changes in one
  consolidation PR.
- Do not auto-close human-authored or fork PRs.
- Do not delete source branches directly from `merge-pr`; let the existing
  branch cleanup workflow handle closed automation branches.
- Do not let `run-zai` approve, merge, close, comment, or push directly unless
  the workflow step owns that side effect.

## Acceptance criteria

- The freshness report can explain why every open PR is fresh, stale, blocked,
  rebase-needed, or consolidation-ready.
- The report is deterministic enough to be unit-tested from fixture JSON.
- Fresh PRs younger than 23 hours are not consolidated.
- Stale PR consolidation candidates preserve unresolved review feedback.
- Existing `pr-flow.yml`, `pr-finalizer.yml`, `fix-review.yml`, and `stale.yml`
  semantics remain intact.
