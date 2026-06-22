# Addressing PR reviews (feedback loop + tooling)

How to work through bot/human review findings on a PR until it clears
(`ai-review-concerns` removed, verdict non-blocking). Tool:
`scripts/pr-review-monitor.sh` (doc: `docs/pr-review-monitor.md`).

## Feedback loop
1. Gather all signals: reviews (`.state`), top-level issue comments
   (`code-review-summary`, `kilo-review` carry the verdict + "Blocking
   findings: N"), inline comments (`.path`/`.line` + `.commit_id`), labels
   (`ai-review-concerns`, `security-review-concerns`, `do-not-merge`,
   `flow/review-blocked` = blocking). `mergeable` + `flow/*` label = gate state.
2. Triage by severity; **stale-filter first**: an inline/review comment's
   `commit_id` older than the current HEAD was likely already addressed by a
   newer push — GitHub also re-maps some comments onto the new HEAD, so
   `commit_id == HEAD` does NOT guarantee it's still live; verify against code.
3. Fix → validate → push → re-monitor. Each push re-triggers the bot reviews
   (~5–15 min); repeat until the verdict clears.

## Monitor tool — `scripts/pr-review-monitor.sh <pr> [--watch sec iters]`
- Caches seen IDs + last label set in `/tmp/pr-review-monitor-<pr>.*`; prints
  only deltas after the baseline poll. Namespaces IDs by source
  (`comment:`/`review:`/`inline:`) — those ID spaces are independent.
- `†stale@<sha>` = comment on a commit older than HEAD; `‼` = item text
  mentions "blocking"; `labels +x -y` = diff; quiet `no change` line on idle
  watch polls.
- Parses `gh api` output with `join("")` + `IFS=$'\x1f' read` (NOT
  `@tsv`+tab — tab is whitespace and collapses empty fields).

## Engineering patterns for the fix step (all learned the hard way)
- **Fail closed** on any `gh`/API error: `try/catch` → `::error::` + `exit 1`,
  and surface `error.stderr` (the GitHub reason), not the generic
  `Command failed` message. A swallowed error = silent no-op that looks green.
- **Dry-run hides side-effects**: a `--dry-run` path never reaches DELETE/POST,
  so a broken destructive path passes validation. Smoke-test side-effects
  directly (e.g. `gh api repos/<owner>/<repo>/git/refs/heads/<branch>` GET must
  200; without `repos/` it 404s).
- **No result caps**: `gh pr list --limit N` truncates at N; use
  `gh api repos/<repo>/pulls?state=open --paginate` or GraphQL
  `refs(refPrefix:"refs/heads/", first:100)` + cursor. Asymmetric pagination
  (branches paginated, PR heads capped) is the same bug class as the cap.
- **TDD the uncovered path**: extract a pure helper (selector / path-builder /
  arg-parser) + unit test for any logic only reached inside the I/O `run()`.
  Sibling pattern: `find-duplicate-automation-pr.cjs`, `check-pending-automation-pr.cjs`.
- **Validate workflow edits**: `actionlint` (YAML), `prettier --check` +
  `eslint` (JS/CJS/TS), `node --test .github/workflows/scripts/__tests__` AND
  `npm run test-only` (the latter runs `src/lib/__tests__/workflow-triggers.test.ts`,
  which can break on YAML edits). See `mem:ci/testing-and-validation`.

## Bot reviewers on this repo
- `kilo-code-bot`: "Code Review Summary" — `Status`/`Recommendation`, severity
  table (CRITICAL/WARNING/SUGGESTION/nitpick), marks prior findings resolved.
- `github-actions` (code-review): "code-review-summary" — pass/concerns +
  `Blocking findings: N`; security review separate. Inline comments carry the
  actionable detail (often past the one-line preview).
- Review-stack routing (run-zai → run-claude-params): `mem:ci/claude-review-stack`.
