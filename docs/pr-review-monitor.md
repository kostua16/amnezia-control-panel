# PR Review Monitor

`scripts/pr-review-monitor.sh` — a small local utility that watches a pull
request for new reviews, comments, inline review comments, and label changes,
printing only what has changed since the last poll. It is the fast feedback
loop for the [addressing-PR-reviews workflow](#addressing-pr-reviews-workflow)
below.

## Usage

```bash
./scripts/pr-review-monitor.sh <pr-number>                  # one-shot check
./scripts/pr-review-monitor.sh <pr-number> --watch          # loop, 60s
./scripts/pr-review-monitor.sh <pr-number> --watch 60 12    # loop, 60s × 12
```

Requires `gh` (authenticated) and `jq`-free parsing (it uses `gh api --jq`).
Seen item IDs and the last label set are cached per PR under `/tmp/`, so each
poll after the first prints only deltas.

## Output legend

| Marker | Meaning |
| --- | --- |
| `comment` / `review [STATE]` / `inline path:line` | new item of that kind |
| `@<sha>` | the commit a review/inline comment landed on |
| `†stale@<sha>` | the comment is on a commit **older than the current HEAD** — likely already addressed by a newer push; verify before acting |
| `‼` | the item's text mentions "blocking" — a likely blocker |
| `labels +x -y` | labels added/removed since the last poll |
| `‼ BLOCKING LABELS: …` | a blocking label is present (`ai-review-concerns`, `security-review-concerns`, `do-not-merge`, `flow/review-blocked`) |
| `no change` | (watch mode) nothing changed this poll |

## Addressing-PR-reviews workflow

1. **Gather** — run the monitor (or `gh pr view`/`gh api`) to collect every
   signal: reviews (state), top-level comments (`code-review-summary`,
   `kilo-review`), inline comments (`path:line` + `commit_id`), and labels.
2. **Triage** — sort by severity (blocking → warning → suggestion → nitpick).
   Treat `†stale` comments as probably-resolved: confirm against the current
   HEAD before re-addressing. A `‼ BLOCKING LABELS` line means the PR cannot
   merge until those findings are cleared.
3. **Fix** — for each actionable finding:
   - Reproduce/verify empirically before changing code (e.g. run the flagged
     `gh api` path both ways).
   - Prefer a **pure, unit-tested helper** for any logic that was uncovered by
     tests (selectors, path builders, arg parsers) — TDD.
   - Make API/error paths **fail closed** (exit non-zero with `::error::`) and
     surface the real reason (`error.stderr`), never a silent no-op.
4. **Validate** — `actionlint` (workflow YAML), `prettier --check` + `eslint`
     (`.js`/`.cjs`/`.ts`), `node --test .github/workflows/scripts/__tests__`
     (workflow e2e) and `npm run test-only`; add a live smoke for any path the
     unit tests cannot reach (e.g. a destructive side-effect hidden behind a
     dry-run).
5. **Push** to the PR branch, then **re-run the monitor** — a new commit
   re-triggers the bot reviews; repeat until `ai-review-concerns` is gone and
   the verdict clears.

## Common pitfalls (observed)

- `gh api` REST paths require the `repos/` prefix; a dry-run never exercises
  DELETE/POST side-effects, so validate those paths explicitly.
- `gh pr list --limit N` caps results — use `gh api .../pulls --paginate` or
  GraphQL `refs(first:100)` + cursor pagination for unbounded fetches.
- In bash, `IFS=$'\t' read` collapses empty fields (tab is whitespace); use a
  non-whitespace delimiter such as `\x1f`.
- In jq, `|` is lowest-precedence: `[.id|tostring, …]` parses as
  `.id | (…)`. Parenthesize: `[(.id|tostring), …]`.

## Serena memory

The durable, agent-facing version of this workflow lives in
`mem:ci/addressing-pr-reviews` (`.serena/memories/ci/addressing-pr-reviews.md`)
and is recalled by name when a review-addressing task comes up.
