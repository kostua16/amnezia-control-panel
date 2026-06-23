#!/usr/bin/env bash
# Local utility (NOT committed): monitor a PR for new reviews / top-level
# comments / inline review comments and label changes.
#
# Improvements baked in from watching #487:
#   - commit context: every review/inline shows the commit it landed on, and a
#     †stale mark when that commit is older than the current HEAD (so a comment
#     already addressed by a newer push is obvious — the gap that made a fixed
#     comment re-surface as "new").
#   - label diff: prints +added / -removed instead of dumping the old label set.
#   - blocking signal: flags blocking labels and highlights ‼ blocking findings.
#   - quiet idle polls: in watch mode, a no-change poll prints one compact line.
#
# See docs/pr-review-monitor.md for the full workflow + output legend.
#   ./pr-review-monitor.sh <pr>                 # one-shot
#   ./pr-review-monitor.sh <pr> --watch [sec] [iters]
set -u

PR="${1:?usage: $0 <pr> [--watch <sec> <iters>]}"
shift || true
INTERVAL=60; MAX_ITERS=0; WATCH=false
if [[ "${1:-}" == "--watch" ]]; then
  WATCH=true; shift; INTERVAL="${1:-60}"; MAX_ITERS="${2:-0}"
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [ -z "$REPO" ]; then
  echo "error: could not detect the repository; run from a repo checkout" >&2
  exit 1
fi
IDS="/tmp/pr-review-monitor-${PR}.ids"
LBL="/tmp/pr-review-monitor-${PR}.labels"   # newline-separated, last-seen labels
touch "$IDS"
BLOCKING_LABELS="ai-review-concerns security-review-concerns do-not-merge flow/review-blocked"

# stdin: TSV rows  id \t commit \t location \t body
emit_new() {
  local kind="$1" head="$2" id commit loc body key mark stale
  while IFS=$'\x1f' read -r id commit loc body; do
    [ -z "$id" ] && continue
    key="${kind}:${id}"
    grep -qxF "$key" "$IDS" 2>/dev/null && continue
    printf '%s\n' "$key" >> "$IDS"
    mark=""
    if printf '%s' "$body" | grep -qiE "blocking|blocker"; then mark="‼ "; fi
    stale=""
    if [ -n "$commit" ] && [ -n "$head" ] && [ "${commit:0:7}" != "${head:0:7}" ]; then
      stale=" †stale@${commit:0:7}"
    elif [ -n "$commit" ]; then
      stale=" @${commit:0:7}"
    fi
    printf '  %s%-9s %s%s :: %s\n' "$mark" "$kind" "$loc" "$stale" "$body"
  done
}

poll() {
  local first=false; [ ! -s "$IDS" ] && first=true

  local st mb head cur_list prev_list
  IFS=$'\t' read -r st mb head <<< "$(gh pr view "$PR" --repo "$REPO" \
    --json state,mergeable,headRefOid -q '[.state,.mergeable,.headRefOid]|@tsv' 2>/dev/null || printf '??\t??\t')"
  cur_list="$(gh pr view "$PR" --repo "$REPO" --json labels -q '.labels[].name' 2>/dev/null || true)"
  prev_list="$(cat "$LBL" 2>/dev/null || true)"
  printf '%s\n' "$cur_list" > "$LBL"

  # label diff (added = only in current; removed = only in previous)
  local added removed
  added="$(comm -23 <(printf '%s\n' "$cur_list" | sort -u) <(printf '%s\n' "$prev_list" | sort -u) | paste -sd, -)"
  removed="$(comm -13 <(printf '%s\n' "$cur_list" | sort -u) <(printf '%s\n' "$prev_list" | sort -u) | paste -sd, -)"

  # blocking labels currently present
  local blocking=""
  for bl in $BLOCKING_LABELS; do
    if printf '%s\n' "$cur_list" | grep -qx "$bl"; then blocking="${blocking:+$blocking,}$bl"; fi
  done

  # gather new items into a buffer (also marks them seen)
  local buf=""
  buf+="$(gh api "repos/$REPO/issues/$PR/comments" --jq \
    '.[] | [(.id|tostring), "", "", (.body | split("\n")[0] | .[0:120])] | join("\u001f")' 2>/dev/null \
    | emit_new comment "$head")"$'\n'
  buf+="$(gh api "repos/$REPO/pulls/$PR/reviews" --jq \
    '.[] | [(.id|tostring), (.commit_id // ""), "[\(.state)]", (.body | split("\n")[0] | .[0:80])] | join("\u001f")' 2>/dev/null \
    | emit_new review "$head")"$'\n'
  buf+="$(gh api "repos/$REPO/pulls/$PR/comments" --jq \
    '.[] | [(.id|tostring), (.commit_id // ""), "\(.path):\(.line // .original_line // "?")", (.body | split("\n")[0] | .[0:100])] | join("\u001f")' 2>/dev/null \
    | emit_new inline "$head")"$'\n'
  local has_new=0
  [ -n "$(printf '%s' "$buf" | tr -d '[:space:]')" ] && has_new=1

  # quiet idle poll in watch mode
  if $WATCH && ! $first && [ -z "$added" ] && [ -z "$removed" ] && [ "$has_new" = "0" ]; then
    printf '%s  no change\n' "$(date -u +%H:%M:%SZ)"; return
  fi

  echo "### $(date -u +%Y-%m-%dT%H:%M:%SZ) — PR #$PR"
  echo "  [${st}] mergeable=${mb} head=${head:0:7} | labels: $(printf '%s' "$cur_list" | paste -sd, -)"
  if ! $first; then
    [ -n "$added" ]   && echo "  labels +${added}"
    [ -n "$removed" ] && echo "  labels -${removed}"
  fi
  [ -n "$blocking" ] && echo "  ‼ BLOCKING LABELS: ${blocking}"
  $first && echo "  (baseline poll — seeding; later polls print new items only; †stale = comment on a commit older than HEAD)"
  printf '%s' "$buf"
  echo
}

if $WATCH; then
  iter=0
  while :; do
    poll
    iter=$((iter + 1))
    if [ "$MAX_ITERS" -gt 0 ] && [ "$iter" -ge "$MAX_ITERS" ]; then
      echo "(watch window ended after $iter poll(s); rerun to continue)"; break
    fi
    sleep "$INTERVAL"
  done
else
  poll
fi
