# Workflow Configuration Reference

Setup guide for installing this repository's GitHub workflow stack on a new repo.

## Required Secrets

Settings -> Secrets and variables -> Actions -> **New repository secret**

| Secret             | Used by                                                                                                                                                                                                                                                    | Description                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`      | `claude`, `triage`, `code-review`, `dependency-review`, `release-notes`, `maintenance`, `fix-pr`, `fix-branch`, `pr-improve`, `workflow-health-optimize`, `audit-auto-prs`, `monitor-amnezia-control-panel-github-runs`                                    | API key for the Claude-compatible coding workflows (Z.AI provider)                                                                                              |
| `GEMINI_API_KEY`   | `antigravity`, `antigravity-code-review`                                                                                                                                                                                                                   | API key for the Antigravity CLI agent workflows                                                                                                                 |
| `AV_API_KEY`       | `antigravity`, `antigravity-code-review`                                                                                                                                                                                                                   | Alternative API key for the Antigravity CLI agent workflows                                                                                                     |
| `DEEPSEEK_API_KEY` | `deepseek`, `deepseek-code-review`                                                                                                                                                                                                                         | API key for DeepSeek coding workflows (Anthropic-compatible endpoint). Optional — workflows skip gracefully when not set.                                       |
| `GH_PAT`           | `triage`, `fix-issue`, `issue-catch-up`, `fix-pr`, `fix-branch`, `workflow-health-optimize`, `pr-improve`, `audit-fix`, `audit-auto-prs`, `monitor-amnezia-control-panel-github-runs`, `suggest-improvements`, `docs-drift`, `maintenance`, `_auto-fix-ci` | Push-capable Personal Access Token used when a workflow must push branches, create PRs, or create automation artifacts that should trigger downstream workflows |

`GITHUB_TOKEN` is automatic and is sufficient for read/comment/approve operations that do not need recursive workflow triggering.

## Why `GH_PAT` still exists

This repo intentionally keeps `GH_PAT` for the workflows that create commits, branches, or PRs and rely on downstream workflows to run afterward. Pushes and PR mutations performed with the default `GITHUB_TOKEN` do not reliably trigger the downstream workflow chain this repo depends on.

Use `GITHUB_TOKEN` for:

- `pr-flow` orchestration and worker dispatch
- `pr-finalizer`
- review-signal labeling
- release creation
- comments and lightweight metadata updates

Use `GH_PAT` for:

- automation-created branches and commits
- planning intake and GSD execution branches from `pr-improve`, `suggest-improvements`, and `gsd-planning-execute`
- issue triage/fix flows that create or push automation artifacts

## Workflow Map

```text
CI
  -> fix-pr.yml (same-repo PR failure path)
  -> fix-branch.yml (direct push failure path)
  -> pr-flow.yml (wakes orchestrator after CI settles)

fix-pr.yml
  -> fetches the source PR metadata before calling _auto-fix-ci
  -> skips recursive child PR creation when the failing PR is already automation-authored

pr-flow-watchdog.yml
  -> scheduled/manual stale-state recovery
  -> dispatches pr-flow.yml for open non-draft PRs still labeled flow/draft

audit-auto-prs.yml
  -> scheduled/manual audit of automation-created open PRs
  -> gathers exact PR/run/check/diff evidence before grouping duplicates or repeated patterns
  -> opens a ready-for-review manual-only systemic-fix PR only when the audit produced a narrow repo change
  -> writes no-change, duplicate-suppressed, and human-disposition audit reports to the workflow run summary

pull_request_target lifecycle events
  -> pr-flow.yml
  -> reads .github/pr-flow.json, classifies the PR, syncs one flow/* state label, and dispatches one next worker
  -> publishes commit statuses on the PR head SHA for pr-flow/ready and worker visibility
  -> upserts one PR Flow Orchestration comment with worker links and latest decisions
  -> treats draft-to-ready as orchestration only; CI reruns require a new commit

code-review.yml
-> dispatch-only worker controlled by pr-flow.yml
-> /review issue comments wake pr-flow.yml; once required checks are green,
   pr-flow dispatches this worker with the current PR head SHA
-> produces ai-review-passed / ai-review-concerns
  -> produces security-review-passed / security-review-concerns
  -> pr-flow.yml consumes those signals
-> when orchestrated, explicitly wakes pr-flow.yml and auto-cover-review.yml
   after completion so repair loops do not depend on workflow_run delivery alone

auto-cover-review.yml
  -> event-driven review repair dispatcher: Code Review completion, trusted
     kilo-code-bot `<!-- kilo-review -->` comments, workflow_dispatch, and a
     scheduled fallback
  -> evaluates internal review concern labels plus Kilo current-head feedback
  -> dispatches fix-review.yml on `--ref main` with automation_review_loop=true
  -> allows manual-only / needs-review PRs to be repaired, but never approves,
     merges, removes needs-review, or bypasses do-not-merge

deepseek.yml
  -> standalone @deepseek trigger (issue_comment, PR review, issues)
  -> same trigger pattern as claude.yml but with @deepseek mention
  -> uses run-deepseek action with DEEPSEEK_API_KEY
  -> skips gracefully when DEEPSEEK_API_KEY secret is not set

deepseek-code-review.yml
  -> standalone non-blocking code review via /deepseek-review comment or workflow_dispatch
  -> single-phase review (no separate security phase)
  -> produces deepseek-review-passed / deepseek-review-concerns (non-blocking labels)
  -> NOT integrated into pr-flow.yml — runs independently
  -> skips gracefully when DEEPSEEK_API_KEY secret is not set

fix-review.yml
  -> maintainer-only /fix-review or /address-review PR comment (issue_comment) or workflow_dispatch
  -> automation_review_loop=true is reserved for auto-cover-review.yml and may
     repair same-repo review-blocked/manual-only PRs without changing merge policy
  -> pre-fetches unresolved, non-outdated review threads + reviews + filtered PR comments
  -> applies fixes in place on the SAME PR head branch (never a new branch, never force-pushes)
  -> CI-matching gate (npm run test && npm run build + script tests + Prisma-safe check) must pass before push
  -> disables auto-merge after a fix push so the bot commit is re-reviewed before merge
  -> sticky summary comment: started -> working -> finished (or skipped / no-changes / push-rejected / validation-failed / failed / cancelled)
  -> human command path remains standalone; automation_review_loop is dispatched
     by auto-cover-review.yml

dependency-review.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> produces deps-review-passed / deps-review-manual / deps-review-blocked
  -> pr-flow.yml consumes those signals for Dependabot PRs

antigravity.yml
  -> interactive issue/PR comment handler using Antigravity CLI
  -> triggered by @gemini or @antigravity mentions

antigravity-code-review.yml
  -> dispatch-only worker or manual PR review using Antigravity CLI
  -> produces antigravity-review-passed / antigravity-review-concerns

pr-improve.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> creates or updates claude-planning-pr-<pr-number> planning intake PRs
  -> updates ROADMAP.md intake and source-PR namespaced quick artifacts

gsd-planning-execute.yml
  -> scheduled/manual worker that runs four times per day
  -> imports one merged .planning/quick artifact into Phase 999 per run
  -> executes the imported GSD wave and opens a non-draft implementation PR

pr-finalizer.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> revalidates configured CI checks, review labels, policy, and head SHA
  -> approves and enables auto-merge only for eligible trusted PRs

workflow-health-optimize.yml
  -> hourly compact workflow-run collector and workflow YAML optimizer
  -> creates draft manual-only workflow optimization PRs when provided run evidence supports a narrow YAML change

monitor-amnezia-control-panel-github-runs.yml
  -> hourly run-zai monitor for completed, failed, flaky, or slow GitHub Actions runs
  -> inspects live run data and logs with gh, applies narrow safe fixes, and opens ready-for-review manual-only PRs when useful
```

## PR Flow Visibility

`pr-flow/ready` is the only PR-flow status context that should be required in
branch protection or repository rulesets. The per-worker contexts are visible
diagnostics: `pr-flow/code-review`, `pr-flow/security-review`,
`pr-flow/dependency-review`, `pr-flow/kilo-review`, `pr-flow/pr-improve`, and
`pr-flow/finalizer`.

Dispatch-only workers run through `workflow_dispatch`. GitHub associates a
`workflow_dispatch` run with the dispatched ref, which is normally `main` here,
not with the PR head commit. That means dispatched worker runs do not naturally
appear as native PR checks for the head SHA. `pr-flow.yml` bridges that gap by
writing commit statuses directly to the PR head SHA and by updating the sticky
`<!-- pr-flow-orchestration -->` PR comment.

The sticky PR Flow comment also renders state-specific next steps and relevant
operator controls. It is rebuilt on each orchestrator run, including worker
wakeups, so labels such as `skip-improve`, `needs-review`, `do-not-merge`, and
`maintainer-approved`, plus PR comments such as `/approve` and `/review`, are
reflected in the guidance as the PR moves through the flow. Manual `/review`
comments are PR Flow control inputs: PR Flow resolves the current PR head,
clears stale review signal labels, and dispatches `code-review.yml` through
`workflow_dispatch`.

Kilo Code is modeled as an external advisory review signal rather than a
dispatch worker. Current-head `kilo-code-bot` findings block PR Flow as
`flow/review-blocked`; a current-head `No Issues Found` summary passes; a
cancelled/skipped Kilo check or no current-head reply after 30 minutes is
treated as skipped so Kilo cannot wedge the queue. `pr-flow-watchdog.yml`
wakes expired `pr-flow/kilo-review` pending states so the timeout is applied.

Worker completion also explicitly wakes `pr-flow.yml` with `workflow_dispatch`
when the worker was orchestrator-dispatched. The `workflow_run` trigger remains
as a useful backup for native CI and other visible runs, but `GITHUB_TOKEN`
dispatch chains should not rely on `workflow_run` alone for progression.
`pr-flow-watchdog.yml` also wakes open non-draft PRs that are still labeled
`flow/draft` or whose current head SHA has no `pr-flow/ready` status.

`fix-pr.yml` also treats automation-authored PRs as a stop point for the CI
auto-fix lane. If the failing source PR already has the `auto-fix` label or is
already on a generated automation branch, the workflow logs the reason and
skips opening a second child PR against that branch.

The worker run-name contract is part of the orchestration API: worker run names
must include `PR #<number> @ <head_sha>`. `orchestrate-pr-flow.cjs` uses that
pattern to match active or completed dispatch runs back to the current PR head
and to avoid double dispatching stale workers.
`pr-flow.yml` also uses the same `PR #` display-title prefix to keep
PR-related `workflow_run` wakeups when GitHub omits `pull_requests` from the
event payload, while still skipping issue-only runs before setup.

Branch protection setup is external repository state. After the first
orchestrator run creates `pr-flow/ready`, require exactly that context if PR-flow
completion should block merges.

`pr-finalizer.yml` does not use GitHub branch-protection required checks for its
own merge decision. It reads all PR checks, filters them through
`.github/pr-flow.json`, and validates only the configured CI jobs such as
`CI / Lint`, `CI / Type Check`, `CI / Test`, and `CI / Build`. This keeps
`pr-flow/ready` from becoming a circular prerequisite for the finalizer that
sets `pr-flow/ready`.

Manual-review markers such as `needs-review` and manual-only policy paths still
run advisory Code Review and Security Review after CI is green. Once those
review signals pass, PR flow completes as `flow/manual-only`: `pr-flow/ready`
can pass for branch protection, but PR Finalizer and auto-merge stay disabled so
a human makes the final decision. Hard blockers such as `do-not-merge`,
AI/security concern labels, and blocked dependency labels still fail
`pr-flow/ready`.

> See [PR Orchestrator Concurrency](#pr-orchestrator-concurrency) for how
> `pr-flow.yml` groups runs by event class and why a cancelled `orchestrate`
> check should no longer appear on PRs.

## PR Orchestrator Concurrency

`pr-flow.yml` keys its concurrency group per PR but **isolates
`pull_request_target` runs from every reactive wake**, so nothing but a newer PR
state change can cancel the prt `orchestrate` job:

| event class         | concurrency group    | triggers                                                                                                                                              |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| pull_request_target | `pr-flow-prt-<PR#>`  | `opened` / `synchronize` / `reopened` / `ready_for_review` / `converted_to_draft` / `labeled` / `unlabeled`                                           |
| reactive wake       | `pr-flow-wake-<PR#>` | `workflow_run` (CI, PR Policy, Code Review, Dependency Review, PR Improve, PR Finalizer completed), `issue_comment` (`/approve`), `workflow_dispatch` |

prt state-change runs still cancel older prt runs via `cancel-in-progress`; wakes
collapse among themselves. A wake can never cancel a prt run, so the prt
`orchestrate` — the only run that reports a check on the PR — always runs to
completion (green or skipped, never `cancelled`).

### Why cancellation exists at all

`pr-flow.yml` has two feedback loops that would otherwise flood the **shared
self-hosted runner pool**:

1. **Label loop** — orchestrate adds `flow/*` labels → `pull_request_target`
   `labeled` → re-triggers pr-flow. Bot-applied labels are prefiltered by
   `evaluate-trigger-policy.cjs` (`should_run=false` — "re-evaluates on
   workflow_run completion"), and `cancel-in-progress` is `false` for
   `labeled`/`unlabeled`.
2. **Worker/check loop** — orchestrate dispatches a worker (or CI runs) → it
   completes → `workflow_run` → re-triggers pr-flow. This is intentional: pr-flow
   re-evaluates after each worker/check finishes.

`cancel-in-progress` collapses the redundant wakes so only the newest run per
class executes — protecting limited runner capacity.

### The cancellation cascade this design fixes

Previously all triggers shared one `pr-flow-<PR#>` group, so any newer run with
`cancel-in-progress: true` cancelled the in-flight `pull_request_target`
`orchestrate` job before it ran a step. Two cancellers stood out:

- a fast completing check (PR Policy finishes in ~1.5–3 min) fires `workflow_run`;
- a bot `issue_comment` (e.g. an automation posting on the PR shortly after open).

Only `pull_request_target` runs surface as **PR checks** — `workflow_run`,
`issue_comment`, and `workflow_dispatch` runs execute on the default branch and do
not attach a check to the PR head — so this showed as a red `cancelled`
"PR Orchestrator" check. Functionally it was cosmetic: a later wake completed
orchestration and posted `pr-flow/ready`, so PRs stayed mergeable.

A first attempt split only `workflow_run` into its own group (`pr-flow-wr` vs
`pr-flow-live`), but `issue_comment` still shared the `live` group and kept
cancelling the prt orchestrate. Isolating `pull_request_target` alone in
`pr-flow-prt` — with all wakes in `pr-flow-wake` — removes the cancelled check
entirely while keeping wake-side collapsing intact.

### Dispatch safety under concurrent runs

With the split, a `live` and a `wr` orchestrate can run concurrently. This is safe
because every dispatch is **label-guarded**:

- review workers (code-review, dependency-review, security) check for existing
  `*-review-passed` / `*-review-concerns` / `flow/review-pending` labels first;
- the finalizer checks `flow/finalizer-dispatched` for the current head SHA;
- PR Improve checks `flow/improve-pending`.

In practice the two classes rarely overlap: the prt orchestrate finishes (~70 s)
before the first `workflow_run` wake (PR Policy ~90 s+) starts.

### Runner-count assumption

This design assumes **at least two self-hosted runners** (three or more currently
in use). Measured durations (setup overhead included):

| job                                 | duration            | runner label          | required for `pr-flow/ready` |
| ----------------------------------- | ------------------- | --------------------- | ---------------------------- |
| CI Lint / Type Check / Build / Test | 43 / 62 / 55 / 53 s | `[self-hosted,big]`   | yes                          |
| CI Security Audit                   | ~35 s               | `[self-hosted,big]`   | no                           |
| PR Policy (`label-and-validate`)    | ~60–120 s           | `self-hosted`         | yes                          |
| pr-flow orchestrate                 | ~70 s               | `self-hosted`         | posts `pr-flow/ready`        |
| Dependency Review                   | 3–12 min            | `self-hosted` + `big` | no                           |
| Code Review                         | 6–12 min            | `self-hosted`         | review signal                |
| PR Improve / Finalizer              | 5–7 min / ~1 min    | `self-hosted`         | dispatched later             |

Time-to-ready (required checks green + `pr-flow/ready` posted) by runner count:

| self-hosted runners | wall-clock   | notes                                                                                                                         |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1                   | ~7.5–8.5 min | CI's 4 jobs serialize — the bottleneck. The concurrency choice swings only ~1–2 min here; a **2nd runner** is the real lever. |
| 2                   | ~3.5–4.5 min | event-class split is effectively free (extra prt orchestrate rides the spare runner)                                          |
| 3+                  | ~3 min       | split is free; pick the design on correctness/cosmetics                                                                       |

If the pool is ever downsized to a single runner, revisit this design: the
event-class split then costs ~1–2 min per push, and collapsing more aggressively
(or dropping redundant `pull_request_target` triggers) may be preferable.

## Policy Labels

The following labels are enforced or created automatically by the workflow stack:

| Label                         | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `ai-review-passed`            | Main AI review found no blocking issues                 |
| `ai-review-concerns`          | Main AI review found blocking issues                    |
| `security-review-passed`      | Security review found no significant issues             |
| `security-review-concerns`    | Security review found significant issues                |
| `deepseek-review-passed`      | DeepSeek code review found no issues (non-blocking)     |
| `deepseek-review-concerns`    | DeepSeek code review found concerns (non-blocking)      |
| `deps-review-passed`          | Dependabot PR remains auto-merge eligible               |
| `deps-review-manual`          | Dependency PR needs manual review                       |
| `deps-review-blocked`         | Dependency PR is blocked from auto-merge                |
| `skip-improve`                | Skip the Claude+GSD improvement analysis flow           |
| `planning-intake-open`        | A planning intake PR exists for follow-up work          |
| `planning-draft-open`         | Legacy alias for existing planning intake PRs           |
| `gsd-plan-execution`          | GSD automation is executing merged planning intake      |
| `flow/draft`                  | PR flow is paused while the PR is draft                 |
| `flow/checks-pending`         | PR flow is waiting for required PR checks               |
| `flow/checks-failed`          | PR flow is blocked by failed required PR checks         |
| `flow/checks-unavailable`     | PR flow could not read completed required PR checks     |
| `flow/review-pending`         | PR flow is waiting for review automation                |
| `flow/review-blocked`         | PR flow is blocked by review or policy labels           |
| `flow/review-failed`          | PR flow review automation failed                        |
| `flow/improve-pending`        | PR flow is waiting for improvement intake               |
| `flow/improve-failed`         | PR flow improvement intake failed                       |
| `flow/finalizer-dispatched`   | PR flow dispatched the finalizer for this PR head       |
| `flow/manual-only`            | PR flow completed reviews but requires human merge      |
| `pr-flow/kilo-review`         | Diagnostic status for external Kilo review              |
| `do-not-merge`                | Explicitly block finalizer approval and auto-merge      |
| `auto-fix-approved`           | Maintainer explicitly approved issue auto-fix execution |
| `antigravity-review-passed`   | Antigravity AI code review found no blocking issues     |
| `antigravity-review-concerns` | Antigravity AI code review found blocking concerns      |

Existing operational labels still used by the repo include `auto-fix`, `needs-review`, `triaged`, `duplicate`, `fixed`, `canceled`, and `ci-failure`.

## Trusted Branches

Auto-finalization candidates:

- `claude-auto-fix-ci-*`
- `claude-fix-issue-*`
- `claude-workflow-optimize-*` and `claude-planning-pr-*` when the diff stays under `.planning/**` and review signals pass
- `claude-gsd-planning-execute-*` when the diff stays within the GSD execution safety limits and review signals pass
- `claude-audit-safe-fix-*` when the diff stays within the audit-safe limits and review signals pass
- `dependabot/npm*` and `dependabot/npm_and_yarn/*` when the update is proven to be patch/minor and dependency review passes

Always manual-only:

- `claude-audit-fix-*`
- any PR touching `.github/**`
- any non-trusted PR touching `.planning/**`
- any GSD execution PR touching workflows, package manifests, Prisma/generated code, or more than the GSD execution size limits
- any audit-fix PR touching API routes, auth, sync, API key, panel/server/user config, Prisma/generated code, package manifests, scripts, or more than 10 files / 400 changed lines
- any Dependabot GitHub Actions update
- any dependency PR labeled `deps-review-manual` or `deps-review-blocked`

## Policy Examples

| PR shape                                                                                                                                                                                                                                 | Result                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `claude-auto-fix-ci-main-12345` touching `src/**`, green checks, `ai-review-passed`, `security-review-passed`                                                                                                                            | Finalizer approves and enables squash auto-merge                             |
| `claude-auto-fix-ci-main-12345` touching `.github/workflows/ci.yml`                                                                                                                                                                      | Reviews run after CI; finalizer leaves it manual-only                        |
| `claude-fix-issue-*` missing `security-review-passed`                                                                                                                                                                                    | Finalizer waits for review signals                                           |
| `claude-workflow-optimize-*` touching only `.planning/**`, green checks, `ai-review-passed`, `security-review-passed`                                                                                                                    | Finalizer approves and enables squash auto-merge                             |
| `claude-gsd-planning-execute-*` touching Phase 999 queue and bounded `src/**` changes                                                                                                                                                    | Finalizer approves and enables squash auto-merge after reviews               |
| `claude-gsd-planning-execute-*` touching `.github/**` or package manifests                                                                                                                                                               | Reviews run after CI; finalizer leaves it manual-only                        |
| `claude-audit-safe-fix-*` touching up to 10 files / 400 changed lines under safe `src/components/**`, `src/hooks/**`, `src/lib/**`, `src/types/**`, or `src/app/globals.css`, green checks, `ai-review-passed`, `security-review-passed` | Finalizer approves and enables squash auto-merge                             |
| `claude-audit-safe-fix-*` touching `src/app/api/**`, auth/sync/config paths, Prisma, packages, workflows, or more than 10 files / 400 changed lines                                                                                      | Reviews run after CI; finalizer leaves it manual-only                        |
| `claude-audit-fix-*` from a broad autonomous audit                                                                                                                                                                                       | Reviews run after CI; finalizer leaves it manual-only                        |
| Broad audit fix touching API route + seed/security-sensitive paths and 7+ files                                                                                                                                                          | Reviews run after CI; finalizer leaves it manual-only                        |
| `dependabot/npm_and_yarn/react-*` with patch/minor update and `deps-review-passed`                                                                                                                                                       | Finalizer approves and enables squash auto-merge                             |
| `dependabot/github_actions/actions-checkout-*`                                                                                                                                                                                           | Dependency/review policy runs after CI; finalizer leaves it manual-only      |
| Any PR with `do-not-merge` or a concern/block label                                                                                                                                                                                      | Finalizer does not approve or enable auto-merge                              |
| Any PR with only `needs-review` after CI passes                                                                                                                                                                                          | Code/security reviews run, then PR flow marks manual-only for human decision |

## Composite Action Notes

`setup-environment`:

- installs or reuses GitHub CLI through `kostua16/setup-gh@v1.0.4`; its `auth` output is true only when `gh auth status --hostname` succeeds for the configured host
- switches later `gh` commands to the provided `github-token`, so callers can move between `GITHUB_TOKEN` bot/comment identity and `GH_PAT` commit/PR/workflow-trigger identity
- skips GSD install when `.claude/gsd-install-state.json` is present
- falls back to pinned `@opengsd/get-shit-done-redux` version `1.1.0` only if that file is missing
- installs pinned RTK version `0.35.0`
- optionally installs `uv` (Python package runner) via `install-uv: 'true'` when profile flows need serena MCP server runtime

`run-zai`:

- accepts `github-token` (default `GITHUB_TOKEN`) and passes it to `run-claude-params`
- exposes Claude health and metrics outputs, including `claude_failed`, `claude_failure_reason`, `claude_num_turns`, `claude_is_error`, `claude_used_attempt`, `claude_has_findings`, `claude_failed_tool_samples`, and `claude_metrics_json`
- accepts `claude-full-output`; it defaults to `true` in this private repo but should default to `false` before public reusable workflow extraction
- modify-capable workflows pass `github-token: ${{ secrets.GH_PAT }}`; read-only workflows use the default
- workflows or jobs using `run-zai`/`run-claude` must grant at least `actions: read`; orchestrated workers that wake `pr-flow.yml` must grant `actions: write`
- orchestrator-dispatched `workflow_dispatch` workers run as `github-actions[bot]`, so Claude/ZAI steps must pass `allowed-bots: github-actions,github-actions[bot],claude[bot]` when `orchestrated=true`; do not use wildcard bot allowance
- accepts `plugin-marketplaces` and `plugins` inputs (forwarded to `claude-code-action`) for installing Claude Code plugins per workflow
- workflows are grouped into **plugin profiles** based on their purpose and turn budget:
  - **Profile E (Engineer):** `claude`, `fix-issue`, `_auto-fix-ci`, `audit-fix`, `gsd-planning-execute` — code-editing flows with typescript-lsp, serena (read-only), context7, code-review, security-guidance, code-simplifier, frontend-design, superpowers, caveman (+ commit-commands in claude.yml only)
  - **Profile R (Reviewer):** `code-review`, `audit-auto-prs` — review/inspect flows with typescript-lsp, serena (read-only), context7, code-review, pr-review-toolkit, security-guidance, code-simplifier
  - **Profile P (Planner):** `gsd-planning`, `suggest-improvements`, `pr-improve`, `docs-drift` — planning/propose flows with context7, serena (read-only), caveman
  - **Profile O (Ops):** all remaining flows (triage, release-notes, dependency-review, issue-catch-up, maintenance, workflow-health-optimize, monitor-\*) — no plugins (haiku/label ops, tight budgets, or YAML-only scope)
- serena is restricted to **read-only** by **enumerating each allowed tool by name** — `mcp__plugin_serena_serena__{find_symbol,get_symbols_overview,find_referencing_symbols,find_implementations,find_declaration,search_for_pattern,find_file,list_dir,read_file,get_diagnostics_for_file}`. The `mcp__plugin_serena_serena__*` wildcard is **intentionally NOT** used so `execute_shell_command` and all write tools (`replace_*`, `edit_*`, `write_memory`, `create_text_file`, `safe_delete_symbol`, `delete_memory`) stay blocked. context7 tools use `mcp__plugin_context7_context7__{query-docs,resolve-library-id}`; typescript-lsp tools (Profiles E + R) use the `mcp__plugin_typescript-lsp__*` prefix.
- `pyright-lsp` and `claude-code-setup` plugins are intentionally excluded from CI (pyright: no Python app code; claude-code-setup: risk of rewriting committed `.claude/settings.json`)
- `commit-commands` is included only in `claude.yml` (interactive @claude flows); excluded from automated flows that forbid committing

`run-deepseek`:

- same pattern as `run-zai` but routes to `https://api.deepseek.com/anthropic` (DeepSeek's Anthropic-compatible endpoint)
- model defaults: haiku→`deepseek-v4-flash`, sonnet→`deepseek-v4-pro[1m]`, opus→`deepseek-v4-pro[1m]`
- always sets `CLAUDE_CODE_EFFORT_LEVEL=max` for maximum reasoning depth
- accepts `github-token` (default `GITHUB_TOKEN`) and passes it to `run-claude-params`
- exposes the same Claude health and metrics outputs as `run-zai`
- workflows or jobs using `run-deepseek` must grant at least `actions: read`

`run-claude-params`:

- single source of truth for Claude health normalization
- emits normalized outputs based on structured execution-file parsing first, then sanitized log fallback
- includes capped failed-tool samples in `claude_metrics_json` so issues show the concrete denied or failing commands behind failed-tool counts
- tracks the last attempted Claude run separately from the last successful run so failed attempts still produce useful diagnostics
- decision chain: no attempt → hard failure with action error → missing output → turn limit + error → is_error → 0 turns → error-severity log findings

`report-failure`:

- accepts `github-token` (default `GITHUB_TOKEN`) for label, issue/comment, and triage dispatch operations
- accepts optional Claude metadata, failed-tool samples, and `claude_metrics_json` inputs rendered in a compact `### Claude Execution` section
- parses failed job logs as a fallback so matrix jobs can still surface Claude action errors and sanitized SDK context
- uses resolved labels from the internal `Resolve labels` step to prevent drift

`upsert-pull-request`:

- optionally enforces rich automation PR bodies with `require-rich-body: 'true'`
- captures stderr on labeled creation attempts, retries without labels on failure
- exits non-zero with `::error::` if PR creation fails with and without labels
- null-checks post-create query to prevent silent `null` outputs

`build-automation-pr-body`:

- builds standard automation PR sections: Problem / Trigger, Why Automation Changed This, What Changed, Evidence, and Review Notes
- renders source run, issue, and PR links plus changed files and capped evidence snippets
- consumes Claude/ZAI execution files, structured output, and final output excerpts when available
- redacts common token and secret shapes before writing the body

`commit-and-push`:

- accepts `github-token`; push-capable automation workflows pass `secrets.GH_PAT`
  so branch updates trigger downstream workflows under the trusted PAT actor path
- scopes explicit-token auth to the push process and does not persist
  token-derived headers in `.git/config`
- falls back to the checkout's retained auth only when `github-token` is omitted

`google-github-actions/run-gemini-cli@v0`:

- external action that runs the Gemini CLI (Antigravity) natively
- requires `GEMINI_CLI_TRUST_WORKSPACE: 'true'` for autonomous workspace access

## Dry-Run Entry Points

The following workflows expose `workflow_dispatch` dry-run inputs for safe testing:

- `pr-flow.yml`
- `pr-flow-watchdog.yml`
- `pr-finalizer.yml`
- `pr-improve.yml`
- `issue-catch-up.yml`

`pr-flow.yml` uses `.github/pr-flow.json` for worker order, required checks, reset labels, and managed `flow/*` labels. Routine runs do not recreate labels; pass `--ensure-labels true` to `.github/workflows/scripts/orchestrate-pr-flow.cjs` only for one-time label setup or repair.

If a PR is no longer draft but remains stuck on `flow/draft`, run:

```bash
gh workflow run pr-flow.yml --ref main -f pr_number=<PR> -f dry_run=false
```

`pr-flow-watchdog.yml` runs every 15 minutes away from the top of the hour and performs the same recovery automatically for open non-draft PRs that still have `flow/draft`.

## GSD Slash Command Format

All GSD slash commands in workflow prompts **must** use the colon namespace format (`/gsd:xxx`), not the hyphenated form (`/gsd-xxx`). Claude Code's CLI parser only recognizes `/gsd:xxx` as a valid skill invocation. The hyphenated form is a display alias that the local skill router resolves interactively but the CLI rejects when used as the first token in a prompt — the entire run fails with `Unknown command` at turn 0.

| Use           | Avoid         |
| ------------- | ------------- |
| `/gsd:health` | `/gsd-health` |
| `/gsd:debug`  | `/gsd-debug`  |
| `/gsd:quick`  | `/gsd-quick`  |

## Syntax Gate

`actionlint` should remain the mandatory syntax check after any workflow edit. Run it before merging workflow changes.

---

## See also

- [`CONTEXT.md`](./CONTEXT.md) — glossary for the workflow-automation sub-system (sharpens overloaded terms like "required check").
- [`../../docs/workflow-e2e-scenarios.md`](../../docs/workflow-e2e-scenarios.md) — exhaustive e2e scenario catalog (trigger → terminal) and the machine-checked gate for any workflow change.
- [`../../docs/gh-workflows-architecture-review.md`](../../docs/gh-workflows-architecture-review.md) — architecture review + prioritized (P0/P1/P2) backlog.
