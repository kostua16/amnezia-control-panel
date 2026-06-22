# `/rebase` Workflow Plan

## Main idea

Add a maintainer-triggered workflow that rebases one open same-repo PR onto its
current base branch and uses `run-zai` to resolve conflicts, preserve intent,
and keep visible review feedback in view.

This workflow is a branch-refresh tool, not a merge tool. It updates the same PR
branch in place with `--force-with-lease`, posts one sticky summary, and wakes
the existing PR orchestrator.

```
maintainer /rebase
  |
  v
authorize command
  |
  v
collect PR metadata + review feedback
  |
  v
checkout source branch
  |
  v
git rebase origin/<base>
  |
  +-- clean: validate, push with --force-with-lease
  |
  +-- conflict: run-zai resolves, validate, push with --force-with-lease
  |
  v
sticky summary + wake pr-flow
```

Read it like this: Git performs the normal rebase first. `run-zai` is invoked
only when there is conflict or semantic drift to resolve, and validation decides
whether the branch can be pushed.

## Workflow file

Proposed path:

- `.github/workflows/rebase-pr.yml`

Triggers:

```yaml
on:
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs:
      pr_number:
        description: Pull request number to rebase
        required: true
        type: string
      head_sha:
        description: Expected head SHA, optional stale guard
        required: false
        type: string
      dry_run:
        description: Evaluate and validate without pushing
        required: false
        default: false
        type: boolean
```

Command syntax:

- `/rebase`
- `/rebase main` may be accepted later, but v1 should always use the PR base
  branch from GitHub metadata.

Permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
  actions: write
```

Concurrency:

```yaml
concurrency:
  group: rebase-pr-${{ github.event.issue.number || github.event.inputs.pr_number || github.run_id }}
  cancel-in-progress: true
```

Runners:

- `authorize`: `self-hosted`, 10 minutes.
- `rebase`: `[self-hosted, big]`, 45 minutes.

## Trigger policy

Extend `.github/workflows/scripts/evaluate-trigger-policy.cjs` with mode
`rebase-pr`.

Rules:

- Allow `workflow_dispatch`.
- Allow `issue_comment` only when:
  - the comment is on a PR,
  - the body contains `/rebase`,
  - the commenter is not a bot,
  - the commenter is a maintainer by association.
- Reject non-PR issue comments.
- Reject bot comments.
- Return the PR number and command string.

Output shape:

```json
{
  "mode": "rebase-pr",
  "should_run": true,
  "trusted": true,
  "pr_number": 472,
  "command": "/rebase",
  "author_association": "OWNER"
}
```

Tests:

- Maintainer `/rebase` on PR returns `should_run: true`.
- Maintainer `/rebase` on issue returns `false`.
- Bot `/rebase` on PR returns `false`.
- Non-maintainer `/rebase` returns `false`.
- `workflow_dispatch` returns `true` with the supplied PR number.

## Job design

### `authorize`

Steps:

1. Checkout `main`.
2. Run `setup-environment` with `install-deps: false`.
3. Run `evaluate-trigger-policy.cjs --mode rebase-pr`.
4. If accepted, add an eyes reaction to the command comment.

Outputs:

- `should_run`
- `trusted`
- `pr_number`
- `command`

### `resolve-pr`

Steps:

1. Fetch PR metadata:
   - number
   - state
   - mergedAt
   - isDraft
   - headRefName
   - headRefOid
   - baseRefName
   - isCrossRepository
   - labels
   - autoMergeRequest
2. Run `.github/workflows/scripts/evaluate-pr-policy.cjs`.
3. Refuse to proceed when:
   - PR is closed or merged,
   - PR is draft,
   - PR is cross-repository,
   - expected `head_sha` is supplied and does not match,
   - head branch is missing.

Important: this workflow may rebase manual-only PRs because a rebase is not a
merge approval. It must still refuse `do-not-merge` unless `workflow_dispatch`
sets a future explicit override. V1 should not include the override.

### `collect-feedback`

Reuse `.github/workflows/scripts/collect-review-feedback.cjs` as-is for v1.

Inputs:

- `--repo "$GITHUB_REPOSITORY"`
- `--pr "$PR_NUMBER"`
- `--out "$RUNNER_TEMP/rebase-review-feedback.md"`

The feedback file should be part of the AI prompt even if the rebase has no
conflicts, because rebasing can make existing review comments stale. The agent
should preserve or explicitly report those findings.

### `prepare-branch`

Checkout:

```yaml
- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
  with:
    ref: ${{ steps.pr.outputs.head_ref }}
    fetch-depth: 0
    token: ${{ secrets.GH_PAT }}
```

Setup:

- `setup-environment`
  - `install-deps: true`
  - `generate-prisma: true`
  - `install-rtk: true`
  - `install-gsd: true`
  - `install-uv: true`
- `setup-bot-git`

Fetch:

```bash
git fetch origin "$BASE_REF" --depth=1
git rev-parse HEAD > "$RUNNER_TEMP/original-head.txt"
git rev-parse "origin/$BASE_REF" > "$RUNNER_TEMP/base-head.txt"
```

### `attempt-rebase`

Run:

```bash
set +e
git rebase "origin/$BASE_REF"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "rebase_state=clean" >> "$GITHUB_OUTPUT"
elif [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "rebase_state=conflict" >> "$GITHUB_OUTPUT"
else
  echo "rebase_state=failed" >> "$GITHUB_OUTPUT"
  exit "$status"
fi
```

When state is `clean`, skip directly to validation. When state is `conflict`,
invoke `run-zai`.

### `resolve-conflicts-with-zai`

Use `.github/actions/run-zai`.

Model:

- `opus` for conflict resolution.

Max turns:

- `70`.

Allowed tools:

- Editing: `Edit`, `MultiEdit`, `Write`, `Read`, `Glob`, `Grep`, `LS`.
- Commands: `Bash(git status:*)`, `Bash(git diff:*)`,
  `Bash(git rebase:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(node:*)`,
  `Bash(rtk:*)`.
- MCP read tools already used by `fix-review.yml` may be reused.

Forbidden by prompt:

- Do not push.
- Do not commit.
- Do not merge.
- Do not approve.
- Do not close PRs.
- Do not post comments.
- Do not weaken tests.
- Do not drop source PR intent to make conflicts disappear.

Prompt requirements:

- Read the review feedback file first.
- Continue the in-progress rebase.
- Resolve conflicts by preserving the PR intent and current `main` behavior.
- If a conflict touches a line with unresolved review feedback, address the
  feedback as part of the conflict resolution.
- Run `npx tsc --noEmit` for fast feedback.
- Before finishing, leave the tree with no rebase in progress and no unstaged
  conflict markers.
- Return structured JSON with:
  - `summary`
  - `conflicts_resolved`
  - `review_findings_preserved`
  - `review_findings_addressed`
  - `validation`

Structured schema:

```json
{
  "type": "object",
  "required": [
    "summary",
    "conflicts_resolved",
    "review_findings_preserved",
    "review_findings_addressed",
    "validation"
  ],
  "properties": {
    "summary": { "type": "string" },
    "conflicts_resolved": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "resolution"],
        "properties": {
          "file": { "type": "string" },
          "resolution": { "type": "string" }
        }
      }
    },
    "review_findings_preserved": {
      "type": "array",
      "items": { "type": "string" }
    },
    "review_findings_addressed": {
      "type": "array",
      "items": { "type": "string" }
    },
    "validation": {
      "type": "object",
      "properties": {
        "typecheck": { "type": "string" },
        "tests": { "type": "string" },
        "lint": { "type": "string" },
        "format": { "type": "string" },
        "build": { "type": "string" }
      }
    }
  }
}
```

### `validate`

Use the same gate shape as `fix-review.yml`:

```bash
npm run test
npm run build
node --test .github/workflows/scripts/__tests__/*.test.cjs
node .github/workflows/scripts/check-prisma-safe-sql.cjs
```

If only Markdown docs changed after rebase, a future optimization can use a
smaller gate, but v1 should keep the full branch-refresh gate because rebasing
can pick up arbitrary source changes.

### `push`

Only push when:

- `dry_run` is not true.
- validation succeeded.
- the working tree is clean.
- `git rev-parse HEAD` differs from the original head.

Push:

```bash
git push --force-with-lease origin "HEAD:$HEAD_REF"
```

Do not use plain `--force`.

### `disable-automerge`

If the source PR had auto-merge enabled and the workflow pushed a new commit,
disable auto-merge:

```bash
gh pr merge "$PR_NUMBER" --disable-auto || true
```

Reason: the rebased branch has a new head SHA and should be re-reviewed by
normal PR flow.

### `comment`

Add `.github/workflows/scripts/upsert-rebase-comment.cjs`.

Sticky marker:

```markdown
<!-- rebase-pr-summary -->
```

Modes:

- `started`
- `skipped`
- `conflict-working`
- `complete`
- `validation-failed`
- `push-rejected`
- `failed`

The final comment should include:

- source PR number,
- old head SHA,
- new head SHA,
- base branch and base SHA,
- whether conflicts were resolved by AI,
- validation result,
- pushed or dry-run,
- whether auto-merge was disabled,
- link to workflow run.

### `wake-pr-flow`

After a successful push:

```bash
gh workflow run pr-flow.yml \
  --ref main \
  -f pr_number="$PR_NUMBER" \
  -f dry_run=false
```

## Edge cases

- No changes after rebase: post `complete` with `pushed=false` and wake
  `pr-flow.yml` only if labels/checks are stale.
- Expected head mismatch: post `skipped` and do not push.
- Conflict cannot be resolved: abort rebase, post `failed`, do not push.
- Validation fails: abort if possible or reset to original head, post
  `validation-failed`, do not push.
- Branch protected or push rejected: post `push-rejected`, do not retry with
  plain force.
- Source branch deleted: post `skipped`.
- PR closed during run: do not push.

## Required tests

- `evaluate-trigger-policy.cjs` tests for `/rebase`.
- Workflow trigger tests verifying ignored comments do not cancel active rebase
  runs.
- `upsert-rebase-comment.cjs` tests for each mode.
- A script-level fixture test for head SHA stale guard.
- A workflow e2e scenario in `docs/workflow-e2e-scenarios.md`.

## Acceptance criteria

- Maintainers can comment `/rebase` on an open same-repo PR and get an updated
  branch or a clear sticky failure summary.
- Non-maintainers and bots cannot trigger the workflow.
- The workflow never opens a new PR.
- The workflow never closes the source PR.
- The workflow uses `--force-with-lease`.
- Existing unresolved review feedback is visible to the AI and summarized in the
  outcome.
- A successful push wakes the existing PR orchestrator.
