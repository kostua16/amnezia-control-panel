# `merge-pr` Workflow Plan

## Main idea

Add a daily workflow that reduces stale PR backlog by creating replacement PRs
for compatible stale groups. The replacement PR must carry forward source PR
intent and address unresolved stale review feedback. Source PRs are closed only
after the replacement PR is created, green, linked, and review debt has been
preserved in the replacement PR body.

This workflow is intentionally conservative. It should consolidate one group at
a time by default and should leave source PRs open when validation or grouping
confidence is low.

```
daily schedule
  |
  v
collect stale PRs older than 23h
  |
  v
group by compatibility
  |
  +-- no safe group: report only
  |
  v
build consolidation branch with run-zai
  |
  v
validate
  |
  +-- fail: comment/report, leave source PRs open
  |
  v
open replacement PR
  |
  v
link + label + close source PRs
```

Read it like this: source PRs remain the source of truth until the replacement
is validated and visible. The workflow does not erase review feedback; it turns
that feedback into explicit work for the consolidation branch.

## Workflow file

Proposed path:

- `.github/workflows/merge-pr.yml`

Related plan:

- `.planning/ideas/fresh-prs-plan.md` owns the scanner/reporting layer and may
  dispatch this workflow later with deterministic group JSON. `merge-pr.yml`
  must also work as a standalone scheduled or manually dispatched workflow, and
  it must not infer groups from natural-language report text.

Triggers:

```yaml
on:
  schedule:
    - cron: '37 2 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: Preview without creating, pushing, commenting, or closing
        required: false
        default: true
        type: boolean
      max_groups:
        description: Maximum groups to process
        required: false
        default: '1'
        type: string
      group_filter:
        description: Optional group id to process
        required: false
        default: ''
        type: string
      min_age_hours:
        description: Minimum PR age
        required: false
        default: '23'
        type: string
```

Resolve the effective dry-run value explicitly because `workflow_dispatch`
defaults do not exist on `schedule` events:

```bash
# Set MERGE_PR_DRY_RUN_INPUT from `${{ inputs.dry_run }}` at the step env level
# so an explicit boolean false is preserved as the string "false".
if [ "$GITHUB_EVENT_NAME" = "schedule" ]; then
  effective_dry_run="${MERGE_PR_SCHEDULE_DRY_RUN:-true}"
else
  effective_dry_run="${MERGE_PR_DRY_RUN_INPUT:-true}"
fi
```

Initial rollout should keep `MERGE_PR_SCHEDULE_DRY_RUN=true`. After at least one
manual dry run and one scheduled dry run pass with the expected grouping, the
repo can flip scheduled runs to write mode by setting that variable to `false`.

Permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: write
  checks: read
```

Concurrency:

```yaml
concurrency:
  group: merge-pr-${{ github.event.inputs.group_filter || 'daily' }}
  cancel-in-progress: false
```

Do not cancel an active consolidation run. A cancelled run can leave a branch,
comment, or report half-written.

## Source PR selection

Select open PRs where all are true:

- age is greater than `min_age_hours`, default 23,
- PR is not draft,
- PR is not cross-repository,
- PR is not already merged or closed,
- labels do not include `do-not-merge`,
- labels do not include `keep-open`,
- labels do not include `fresh/superseded`,
- branch still exists,
- source PR changed files can be read,
- source PR review threads can be read.

Do not require mergeability for selection. A conflicting PR may be a good
consolidation source if the replacement branch can apply its intent on current
`main`.

Excluded by default:

- human-authored non-automation PRs unless explicitly labeled
  `fresh/consolidation-candidate`,
- fork PRs,
- security-sensitive manual-only PRs with `do-not-merge`,
- PRs that already have an open replacement PR linked by marker.

Automation evidence is branch/policy based, not just the GitHub PR author. For
example, a PR authored by a maintainer but opened from
`claude-gsd-planning-execute-*` with automation labels still belongs to the
automation backlog.

## Grouping model

Use deterministic grouping before invoking AI. `run-zai` may validate or refine
a group, but it should not be the first source of grouping truth.

Group fields:

- `id`
- `title`
- `kind`: `workflow`, `dependency`, `app-code`, `database`, `planning`,
  `mixed-rejected`
- `source_prs`
- `changed_paths`
- `review_thread_count`
- `conflict_risk`: `low`, `medium`, `high`
- `max_group_size`
- `recommended_action`
- `rejection_reason`

Compatibility rules:

- Never mix `.github/**` workflow changes with runtime app-code changes.
- Never mix `package-lock.json` dependency changes with non-dependency app
  changes.
- Never mix Prisma migrations with unrelated frontend-only changes.
- Prefer groups of 1-3 PRs.
- Split groups if source PRs touch the same files with unrelated review debt.
- Split groups if one source PR is `CONFLICTING` and another is already clean
  unless both share the same domain and the same conflict surface.

Initial group mapping from the evidence snapshot:

| Group id | Source PRs | Kind | Action |
| --- | --- | --- | --- |
| `workflow-automation` | `#472` | workflow | Rebase or consolidate alone. |
| `dashboard-observability` | `#474` | app-code | Consolidate alone. |
| `vpn-user-lifecycle` | `#460`, `#444` | app-code | Consolidate together if conflicts are manageable. |
| `routing-schema-config` | `#442`, `#439` | database | Prefer split unless migration safety is clear. |
| `frontend-api-client` | `#459` | app-code | Rebase first; consolidate alone if still stale. |
| `dependencies` | future stale `#485`, `#483` | dependency | Keep dependency-only and review manually for majors. |

## Review debt handling

The main differentiator from ordinary stale cleanup is review preservation.

Extend `.github/workflows/scripts/collect-review-feedback.cjs` or add a wrapper
that calls it for each source PR and produces one multi-PR bundle.

Proposed wrapper:

- `.github/workflows/scripts/collect-stale-pr-feedback.cjs`

Inputs:

- `--repo`
- `--prs` as comma-separated PR numbers
- `--out`
- `--max-diff-chars-per-pr`

Output Markdown:

````markdown
# Stale PR consolidation feedback

## Source PRs

- #460: title, URL, labels, head ref, mergeability
- #444: title, URL, labels, head ref, mergeability

## Unresolved review threads by PR

### PR #460

- `src/app/api/users/route.ts`:- (@kilo-code-bot): ...

## Diffs by PR

```diff
...
```
````

Rules:

- Include only unresolved, non-outdated review threads.
- Include review submissions with body text.
- Exclude bot sticky comments and slash commands using the same noise filter as
  `collect-review-feedback.cjs`.
- Include diff excerpts for each PR.
- Include changed file lists even when diff is truncated.

The `run-zai` prompt must say:

- Address the review findings in this bundle.
- Preserve source PR intent where it is still correct.
- Drop source changes that are made obsolete by review feedback, but report why.
- Do not copy a reviewed-bad implementation merely because it exists in a source
  branch.

## Branch and PR creation

Branch naming:

```text
claude/stale-pr-merge-<group-id>-<run-id>
```

Use the `claude/` namespace so the existing automation cleanup allow-list can
recognize the closed replacement branch. Initial rollout should keep
replacement PRs manual-review by policy; do not add this prefix to
`trustedAutomationBranchPrefixes` until a separate policy change, e2e scenario,
and review decision explicitly allow auto-finalizing consolidation PRs.

PR title:

```text
fix(stale-prs): consolidate <group title>
```

PR body must be built with the shared rich-body pattern:

- Problem / Trigger
- Why Automation Changed This
- Source PRs
- Review Feedback Addressed
- Validation
- Supersedes
- Review Notes

Implementation should use the existing composite actions where possible:

- `.github/actions/build-automation-pr-body` with the source/review evidence in
  `evidence` or `review-notes`,
- `.github/actions/commit-and-push`,
- `.github/actions/upsert-pull-request` with `require-rich-body: true`.

Required source links:

- `Supersedes #460`
- `Supersedes #444`

Do not use `closes #460` in the replacement PR body. Closing PRs is not the same
as closing issues, and using close keywords for PRs can be confusing. Use an
explicit post-creation close step after the replacement PR exists.

Labels on replacement PR:

- `auto-fix`
- `stale-pr-consolidation`
- `fresh/consolidation-candidate`
- area labels inferred from source paths
- size label from existing policy if available

Add new labels to `.github/workflows/policy.json` before use:

- `fresh/stale`
- `fresh/consolidation-candidate`
- `fresh/superseded`
- `stale-pr-consolidation`

If this workflow ever applies `keep-open` itself, add that label to policy too;
until then, treat it as an operator-owned escape hatch that the selector honors
when present.

## AI implementation step

Use `.github/actions/run-zai`.

Run-ZAI inputs:

- `allowed-bots: github-actions,github-actions[bot],claude[bot]` for scheduled
  or workflow-dispatched runs.
- `github-token: ${{ secrets.GH_PAT }}` for modify-capable runs, matching the
  repo's automation workflow pattern. The prompt and allowed tools still forbid
  the agent from pushing, commenting, closing, approving, or merging.
- `json-schema` matching the structured output below, so malformed results fail
  visibly instead of becoming an implicit no-op.

Model:

- `opus` for groups with review debt or conflicts.
- `sonnet` only for low-risk one-PR doc/planning consolidation.

Max turns:

- `90` for multi-PR groups.
- `60` for one-PR groups.

Allowed tools:

- Editing tools: `Edit`, `MultiEdit`, `Write`, `Read`, `Glob`, `Grep`, `LS`.
- Commands:
  - `Bash(git:*)`
  - `Bash(npm:*)`
  - `Bash(npx:*)`
  - `Bash(node:*)`
  - `Bash(rtk:*)`
  - `Bash(gh pr diff:*)`
  - `Bash(gh pr view:*)`
- The agent may read source PR branches through `git show` or `gh pr diff`.
- Include the same read-only repo-context tools used by existing engineer
  automation profiles when available, such as Serena, Context7, and the
  TypeScript LSP MCP tools.

Forbidden:

- Do not push.
- Do not create PRs.
- Do not close source PRs.
- Do not approve or merge.
- Do not post comments.
- Do not weaken tests.
- Do not include generated local state.

Prompt outline:

```markdown
/gsd:debug
Create a consolidation branch for stale PR group <group-id>.

Read the stale PR feedback bundle first:
<path>

Goals:
- Apply the still-valid intent from each source PR onto current main.
- Address unresolved review feedback from source PRs.
- Keep the result smaller and safer than merging the source branches directly.
- If a source PR contains unsafe code, replace it with a safer implementation or
  report it as skipped.

Rules:
- Do not commit, push, comment, approve, merge, or close PRs.
- Run validation before finishing.
- Return JSON only.
```

Structured output:

```json
{
  "summary": "string",
  "source_prs_applied": [460, 444],
  "source_prs_skipped": [
    { "pr": 444, "reason": "string" }
  ],
  "review_findings_addressed": [
    { "pr": 460, "file": "src/app/api/users/route.ts", "change": "string" }
  ],
  "changed_files": ["src/app/api/users/route.ts"],
  "validation": {
    "test": "pass",
    "build": "pass",
    "workflow_scripts": "pass",
    "prisma_safe": "pass"
  }
}
```

## Validation

The workflow should validate before opening or updating a replacement PR.

Required workflow-change protocol:

```bash
npm run test-only
cd .github/workflows && node --test scripts/__tests__/*.test.cjs
```

Baseline branch validation:

```bash
npm run test
npm run build
node .github/workflows/scripts/check-prisma-safe-sql.cjs
```

Additional validation:

- If `.github/**` changed, run `actionlint`.
- If JS/CJS/TS/TSX files changed, including workflow helper scripts, run lint
  and targeted `npx prettier --check <changed files>`. `npm run format:check`
  only covers `src/**/*.{ts,tsx,css}`.
- If workflow/action YAML changed, run `actionlint -config-file
  .github/actionlint.yaml` and targeted `npx prettier --check <changed files>`.
- If workflow behavior changes, update `docs/workflow-e2e-scenarios.md` in the
  same PR and add/activate the matching workflow-script tests.
- If only Markdown planning files changed outside `.planning/**`, run targeted
  Prettier check.
- If Prisma migrations changed, run migration-specific checks and inspect SQL
  for data-loss patterns.
- If dependency files changed, run `npm audit` and `npm ls`.

No validation, no replacement PR. If validation fails, source PRs stay open.

## Closing source PRs

Close source PRs only after all conditions are true:

- replacement branch pushed,
- replacement PR opened,
- validation passed,
- replacement PR has a passing `pr-flow/ready` status or has intentionally
  reached `flow/manual-only` after advisory review signals passed,
- replacement PR body links every source PR,
- replacement PR body lists review findings addressed/skipped,
- source PR has not received a newer human commit after collection,
- `dry_run` is not true.

Here "green replacement PR" means the replacement PR is visible, validated,
linked, and either finalizer-eligible or explicitly manual-only under the PR-flow
policy. It does not mean the replacement PR has already merged.

Source PR comment:

```markdown
<!-- stale-pr-consolidated -->
This PR was superseded by #<replacement>.

Reason: stale PR consolidation grouped it into `<group-id>` and carried forward
its unresolved review feedback.

Validation: <summary>
Source head at collection: <sha>
Replacement PR: <url>
```

Then:

```bash
gh pr edit "$SOURCE_PR" --add-label "fresh/superseded"
gh pr close "$SOURCE_PR" --comment "$(cat "$comment_file")"
```

Do not delete branches directly.

## Reporting

Add `.github/workflows/scripts/upsert-merge-pr-report.cjs`.

Sticky marker:

```markdown
<!-- merge-pr-report -->
```

Report fields:

- run URL,
- selected groups,
- skipped groups and reasons,
- replacement PR URLs,
- source PR closure results,
- validation summary.

Reports should go to one central tracking issue or the workflow summary. Avoid
posting on every source PR unless it is actually superseded or a consolidation
attempt failed after selecting that PR.

## Failure modes

- Grouping confidence low: report only.
- AI exits with no changes: report no-op, leave source PRs open.
- Validation fails: report failure, leave source PRs open.
- Replacement PR already exists: update it only if it has the marker and the
  same source PR set.
- Source PR updated after collection: skip closing that source PR and report
  stale source data.
- New label or branch prefix is missing from policy: fail before mutation and
  leave source PRs open.
- `run-zai` is blocked because the actor is a bot and `allowed-bots` is missing:
  fail before mutation and leave source PRs open.
- One source PR closes while run is active: exclude it and recompute group.
- Push rejected: report, leave source PRs open.

## Required tests

- Unit tests for stale PR age filtering.
- Unit tests for grouping compatibility:
  - workflow plus app-code rejected,
  - dependencies plus app-code rejected,
  - compatible app-code accepted,
  - max group size enforced.
- Unit tests for multi-PR feedback bundle formatting.
- Unit tests for source PR closure guard.
- Unit tests for sticky report rendering.
- Unit tests or e2e cases for policy-backed labels, branch-prefix handling, and
  manual-only replacement PR behavior.
- Workflow e2e documentation update in `docs/workflow-e2e-scenarios.md`.

## Rollout

1. Add labels and helper scripts.
2. Add `fresh-prs.yml` in report-only mode, following
   `.planning/ideas/fresh-prs-plan.md`.
3. Add `merge-pr.yml` with `workflow_dispatch` only and `dry_run: true`.
4. Run against the current open PR snapshot and inspect grouping.
5. Enable one scheduled dry run.
6. Enable write mode for one low-risk single-PR group.
7. Expand to multi-PR groups after at least two successful replacements.

## Acceptance criteria

- Daily automation can identify stale PR groups older than 23 hours.
- Replacement PRs are one per compatible group.
- Review comments from stale source PRs are addressed or explicitly skipped in
  the replacement PR.
- Source PRs are closed only after a green replacement PR exists.
- Source branches are not deleted by this workflow.
- The existing long-horizon `stale.yml` remains unchanged.
