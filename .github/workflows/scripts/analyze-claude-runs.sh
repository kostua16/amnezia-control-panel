#!/usr/bin/env bash
#
# Bulk-analyze completed CI runs and categorize Claude failures.
#
# Usage:
#   ./scripts/analyze-claude-runs.sh [--limit N] [--json]
#
# Options:
#   --limit N   Number of runs to analyze (default: 50)
#   --json      Output JSON instead of human-readable table
#
# Requires: gh CLI (authenticated), jq
# Compatible with Bash 3.2 (macOS)

set -euo pipefail

LIMIT=50
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --json)  JSON_OUTPUT=true; shift ;;
    *)       echo "Usage: $0 [--limit N] [--json]" >&2; exit 1 ;;
  esac
done

if ! command -v gh &>/dev/null || ! command -v jq &>/dev/null; then
  echo "Error: gh and jq are required" >&2
  exit 1
fi

# --- Accumulators via temp files (Bash 3.2 compatible) ---
TMPDIR=$(mktemp -d /tmp/claude-analyze-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$TMPDIR/cats"
touch "$TMPDIR/all-findings.jsonl"
TOTAL=0

# --- Fetch runs ---
echo "Fetching $LIMIT completed runs..." >&2
RUNS_JSON=$(gh run list --limit "$LIMIT" --json databaseId,status,conclusion,name --jq \
  '[.[] | select(.status == "completed" and .conclusion != "cancelled")]')

RUN_COUNT=$(echo "$RUNS_JSON" | jq 'length')
echo "Analyzing $RUN_COUNT runs..." >&2

# --- Helper: add a finding for a run ---
add_finding() {
  local run_id="$1" category="$2" severity="$3" message="$4" detail="$5"
  # Sanitize detail: strip newlines, truncate
  detail=$(printf '%s' "$detail" | tr '\n' ' ' | cut -c1-300)
  # Write to per-category file
  echo "$run_id" >> "$TMPDIR/cats/$category.ids"
  echo "$detail" >> "$TMPDIR/cats/$category.details"
  # Write structured line for JSON output
  jq -n --arg rid "$run_id" --arg cat "$category" --arg sev "$severity" \
    --arg msg "$message" --arg det "$detail" \
    '{run_id:$rid,category:$cat,severity:$sev,message:$msg,detail:$det}' \
    >> "$TMPDIR/all-findings.jsonl"
}

# --- Helper: extract number after pattern using sed (replaces grep -oP '\K') ---
extract_num() {
  sed -n "s/.*$1[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -1
}

extract_val() {
  sed -n "s/.*$1[[:space:]]*:*[[:space:]]*\"\{0,1\}\([^\",[:space:]]*\).*/\1/p" | head -1
}

# --- Process each run ---
RUNS_ROWS_FILE="$TMPDIR/runs.jsonl"
echo "$RUNS_JSON" | jq -c '.[]' > "$RUNS_ROWS_FILE"
while IFS= read -r ROW; do
  RUN_ID=$(echo "$ROW" | jq -r '.databaseId')
  CONCLUSION=$(echo "$ROW" | jq -r '.conclusion')
  WF_NAME=$(echo "$ROW" | jq -r '.name')
  TOTAL=$((TOTAL + 1))

  if [[ "$CONCLUSION" != "failure" ]]; then
    continue
  fi

  echo "  Scanning run $RUN_ID ($WF_NAME)..." >&2

  LOG=""
  LOG=$(gh run view "$RUN_ID" --log 2>/dev/null) || continue

  # --- Known patterns ---

  # 1. Permission denials
  PD_COUNT=$(echo "$LOG" | grep -o '"permission_denials_count":[[:space:]]*[0-9]*' | grep -o '[0-9]*$' | head -1 || true)
  if [[ -n "$PD_COUNT" && "$PD_COUNT" -gt 0 ]]; then
    if [[ "$PD_COUNT" -gt 5 ]]; then SEV="error"; else SEV="warning"; fi
    DISALLOWED=$(echo "$LOG" | grep -o 'DISALLOWED_TOOLS:.*' | head -1 | sed 's/DISALLOWED_TOOLS:[[:space:]]*//' || true)
    DETAIL="${PD_COUNT} denials"
    [[ -n "$DISALLOWED" ]] && DETAIL="DISALLOWED_TOOLS: $DISALLOWED"
    add_finding "$RUN_ID" "permission_denials" "$SEV" "${PD_COUNT} tool permission denials" "$DETAIL"
  fi

  # 2. Git Push 403
  if echo "$LOG" | grep -qE 'fatal: unable to access.*returned error: 403'; then
    LINE=$(echo "$LOG" | grep -m1 'returned error: 403' | head -c 200 || true)
    add_finding "$RUN_ID" "git_push_403" "error" "Git push failed with HTTP 403" "$LINE"
  fi

  # 3. GraphQL PR failure
  if echo "$LOG" | grep -q 'pull request create failed: GraphQL:'; then
    add_finding "$RUN_ID" "graphql_pr_fail" "error" "GraphQL PR creation failed" "pull request create failed: GraphQL:"
  fi

  # 4. Turn limit hit
  NUM_TURNS=$(echo "$LOG" | grep -o '"num_turns":[[:space:]]*[0-9]*' | grep -o '[0-9]*$' | tail -1 || true)
  MAX_T=$(echo "$LOG" | grep -o '"max_turns":[[:space:]]*[0-9]*' | grep -o '[0-9]*$' | tail -1 || true)
  IS_ERR=$(echo "$LOG" | grep -o '"is_error":[[:space:]]*[a-z]*' | grep -o '[a-z]*$' | tail -1 || true)
  if [[ -n "$NUM_TURNS" && -n "$MAX_T" && "$NUM_TURNS" -eq "$MAX_T" && "$IS_ERR" == "true" ]]; then
    add_finding "$RUN_ID" "turn_limit_hit" "error" "Turn limit hit with error" "Turns: $NUM_TURNS/$MAX_T"
  fi

  # 5. Zero turns
  if [[ -n "$NUM_TURNS" && "$NUM_TURNS" -eq 0 ]]; then
    add_finding "$RUN_ID" "zero_turns" "error" "Claude used zero turns" "num_turns: 0"
  fi

  # 6. Internal error
  if echo "$LOG" | grep -q 'Internal error: directory mismatch'; then
    add_finding "$RUN_ID" "internal_error" "warning" "Internal directory mismatch" "Internal error: directory mismatch"
  fi

  # 7. Disallowed tools (log-level)
  DISALLOWED=$(echo "$LOG" | grep -o 'DISALLOWED_TOOLS:.*' | head -1 | sed 's/DISALLOWED_TOOLS:[[:space:]]*//' || true)
  if [[ -n "$DISALLOWED" && -z "$PD_COUNT" ]] || [[ -n "$DISALLOWED" && -n "$PD_COUNT" && "$PD_COUNT" -eq 0 ]]; then
    add_finding "$RUN_ID" "disallowed_tools" "info" "Disallowed tools detected" "$DISALLOWED"
  fi

  # 8. Action not found
  if echo "$LOG" | grep -q "Can't find 'action.yml'"; then
    add_finding "$RUN_ID" "action_not_found" "error" "Missing action.yml" "action.yml not found"
  fi

  # 9. GraphQL user error
  if echo "$LOG" | grep -qE 'Failed to fetch user display name.*GraphqlResponseError'; then
    add_finding "$RUN_ID" "graphql_user_err" "warning" "GraphQL user fetch failed" "GraphqlResponseError"
  fi

  # 10. Rate limited (all 3 attempts)
  CHECKS=$(echo "$LOG" | grep -c 'is_rate_limited=true' || true)
  if [[ "$CHECKS" -ge 3 ]]; then
    add_finding "$RUN_ID" "rate_limited" "error" "All 3 attempts rate limited" "All attempts hit 429"
  fi

  # 11. Uncategorized errors (fallback)
  UNCATEG=$(echo "$LOG" \
    | grep -E '##\[error\]|Error:|ERR_TEST_FAILURE|"is_error".*true|^fatal:' \
    | grep -v 'Claude Code failed with a non-rate-limit error' \
    | grep -v 'returned error: 403' \
    | grep -v 'pull request create failed: GraphQL:' \
    | grep -v 'Internal error: directory mismatch' \
    | grep -v "Can't find 'action" \
    | grep -v 'GraphqlResponseError' \
    | sort -u | head -3 || true)
  if [[ -n "$UNCATEG" ]]; then
    COUNT=$(echo "$UNCATEG" | wc -l | tr -d ' ')
    DETAIL=$(echo "$UNCATEG" | head -3 | head -c 300)
    add_finding "$RUN_ID" "uncategorized" "error" "$COUNT unrecognized error(s) from Claude run" "$DETAIL"
  fi

done < "$RUNS_ROWS_FILE"

# --- Output ---
if $JSON_OUTPUT; then
  CATEGORIES_JSON="{}"
  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in "$TMPDIR/cats"/*.ids; do
      [[ -f "$CAT_FILE" ]] || continue
      CAT=$(basename "$CAT_FILE" .ids)
      COUNT=$(wc -l < "$CAT_FILE" | tr -d ' ')
      RUNS=$(sort -u "$CAT_FILE" | jq -R . | jq -s .)
      CATEGORIES_JSON=$(echo "$CATEGORIES_JSON" | jq --arg cat "$CAT" --argjson count "$COUNT" --argjson runs "$RUNS" \
        '. + { ($cat): { count: $count, runs: $runs } }')
    done
  fi

  jq -n \
    --arg analyzed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson total "$TOTAL" \
    --argjson categories "$CATEGORIES_JSON" \
    '{ analyzed_at: $analyzed, total_runs: $total, categories: $categories }'
else
  echo ""
  echo "=== Claude CI Run Analysis ($TOTAL runs) ==="
  echo ""

  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in "$TMPDIR/cats"/*.ids; do
      [[ -f "$CAT_FILE" ]] || continue
      CAT=$(basename "$CAT_FILE" .ids)
      COUNT=$(wc -l < "$CAT_FILE" | tr -d ' ')
      PCT=$((COUNT * 100 / TOTAL))
      echo "  $CAT: $COUNT runs ($PCT%)"
    done
  else
    echo "  No failures found."
  fi

  echo ""
  echo "--- Details per category ---"
  echo ""

  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in "$TMPDIR/cats"/*.ids; do
      [[ -f "$CAT_FILE" ]] || continue
      CAT=$(basename "$CAT_FILE" .ids)
      RUNS=$(sort -u "$CAT_FILE" | tr '\n' ' ')
      DETAILS=$(head -2 "${CAT_FILE%.ids}.details" | tr '\n' ' ')
      echo "[$CAT]"
      echo "  Runs: $RUNS"
      echo "  Sample details: $DETAILS"
      echo ""
    done
  else
    echo "  (no failure details to show)"
  fi
fi
