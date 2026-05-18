#!/usr/bin/env bash
#
# Bulk-analyze completed CI runs and categorize Claude failures.
#
# Usage:
#   ./scripts/analyze-claude-runs.sh [--limit N] [--json] [--all]
#
# Options:
#   --limit N   Number of runs to analyze (default: 50)
#   --json      Output JSON instead of human-readable table
#   --all       Include non-Claude workflows (Dependabot, CI, etc.)
#
# Requires: gh CLI (authenticated), jq
# Compatible with Bash 3.2 (macOS)

set -euo pipefail

LIMIT=50
JSON_OUTPUT=false
CLAUDE_ONLY=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --json)  JSON_OUTPUT=true; shift ;;
    --all)   CLAUDE_ONLY=false; shift ;;
    *)       echo "Usage: $0 [--limit N] [--json] [--all]" >&2; exit 1 ;;
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
SCANNED_FAILED=0
RUNS_WITH_FINDINGS="$TMPDIR/runs-with-findings.ids"

# --- Fetch runs ---
SCOPE="Claude workflows only (use --all for every workflow)"
if ! $CLAUDE_ONLY; then
  SCOPE="all workflows"
fi
echo "Fetching $LIMIT completed runs ($SCOPE)..." >&2
RUNS_JSON=$(gh run list --limit "$LIMIT" --json databaseId,status,conclusion,name --jq \
  '[.[] | select(.status == "completed" and .conclusion != "cancelled")]')

RUN_COUNT=$(echo "$RUNS_JSON" | jq 'length')
echo "Analyzing $RUN_COUNT runs..." >&2

# --- Helper: true when workflow name is a Claude/agent workflow ---
is_claude_workflow() {
  case "$1" in
    "Claude Code"|"Code Review"|"Fix Issue"|"Fix PR"|"Fix Branch"|\
    "Issue Triage"|"Issue Catch-Up"|"Daily Maintenance"|"Release Notes"|\
    "Dependency Review")
      return 0
      ;;
    Workflow\ Health*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# --- Helper: add a finding for a run ---
add_finding() {
  local run_id="$1" category="$2" severity="$3" message="$4" detail="$5"
  # Sanitize detail: collapse whitespace, strip Actions noise, truncate
  detail=$(printf '%s' "$detail" | tr '\n' ' ')
  detail=$(printf '%s' "$detail" | sed \
    -e 's/UNKNOWN STEP[[:space:]]*//g' \
    -e 's/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9:.]*Z[[:space:]]*//g' \
    | sed 's/[[:space:]]\{2,\}/ /g' | cut -c1-300)
  # Write to per-category file
  echo "$run_id" >> "$TMPDIR/cats/$category.ids"
  echo "$detail" >> "$TMPDIR/cats/$category.details"
  echo "$run_id" >> "$RUNS_WITH_FINDINGS"
  # Write structured line for JSON output
  jq -n --arg rid "$run_id" --arg cat "$category" --arg sev "$severity" \
    --arg msg "$message" --arg det "$detail" \
    '{run_id:$rid,category:$cat,severity:$sev,message:$msg,detail:$det}' \
    >> "$TMPDIR/all-findings.jsonl"
}

# --- Process each run ---
RUN_LOG="$TMPDIR/current-run.log"
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

  if $CLAUDE_ONLY && ! is_claude_workflow "$WF_NAME"; then
    continue
  fi

  echo "  Scanning run $RUN_ID ($WF_NAME)..." >&2

  LOG=""
  LOG=$(gh run view "$RUN_ID" --log 2>/dev/null) || continue
  SCANNED_FAILED=$((SCANNED_FAILED + 1))

  printf '%s\n' "$LOG" > "$RUN_LOG"

  # --- Known patterns ---

  # 1. Permission denials
  PD_COUNT=$(grep -m1 -o '"permission_denials_count":[[:space:]]*[0-9]*' "$RUN_LOG" 2>/dev/null \
    | grep -o '[0-9]*$' || true)
  if [[ -n "$PD_COUNT" && "$PD_COUNT" -gt 0 ]]; then
    if [[ "$PD_COUNT" -gt 5 ]]; then SEV="error"; else SEV="warning"; fi
    DISALLOWED=$(grep -m1 -o 'DISALLOWED_TOOLS:.*' "$RUN_LOG" 2>/dev/null \
      | sed 's/DISALLOWED_TOOLS:[[:space:]]*//' || true)
    DETAIL="${PD_COUNT} denials"
    [[ -n "$DISALLOWED" ]] && DETAIL="DISALLOWED_TOOLS: $DISALLOWED"
    add_finding "$RUN_ID" "permission_denials" "$SEV" "${PD_COUNT} tool permission denials" "$DETAIL"
  fi

  # 2. Git Push 403
  if grep -qE 'fatal: unable to access.*returned error: 403' "$RUN_LOG" 2>/dev/null; then
    LINE=$(grep -m1 'returned error: 403' "$RUN_LOG" 2>/dev/null | head -c 200 || true)
    add_finding "$RUN_ID" "git_push_403" "error" "Git push failed with HTTP 403" "$LINE"
  fi

  # 3. GraphQL PR failure
  if grep -q 'pull request create failed: GraphQL:' "$RUN_LOG" 2>/dev/null; then
    add_finding "$RUN_ID" "graphql_pr_fail" "error" "GraphQL PR creation failed" "pull request create failed: GraphQL:"
  fi

  # 4. Turn limit hit
  NUM_TURNS=$(grep -o '"num_turns":[[:space:]]*[0-9]*' "$RUN_LOG" 2>/dev/null \
    | grep -o '[0-9]*$' | tail -1 || true)
  MAX_T=$(grep -o '"max_turns":[[:space:]]*[0-9]*' "$RUN_LOG" 2>/dev/null \
    | grep -o '[0-9]*$' | tail -1 || true)
  IS_ERR=$(grep -o '"is_error":[[:space:]]*[a-z]*' "$RUN_LOG" 2>/dev/null \
    | grep -o '[a-z]*$' | tail -1 || true)
  if [[ -n "$NUM_TURNS" && -n "$MAX_T" && "$NUM_TURNS" -eq "$MAX_T" && "$IS_ERR" == "true" ]]; then
    add_finding "$RUN_ID" "turn_limit_hit" "error" "Turn limit hit with error" "Turns: $NUM_TURNS/$MAX_T"
  fi

  # 5. Zero turns
  if [[ -n "$NUM_TURNS" && "$NUM_TURNS" -eq 0 ]]; then
    add_finding "$RUN_ID" "zero_turns" "error" "Claude used zero turns" "num_turns: 0"
  fi

  # 6. Internal error
  if grep -q 'Internal error: directory mismatch' "$RUN_LOG" 2>/dev/null; then
    add_finding "$RUN_ID" "internal_error" "warning" "Internal directory mismatch" "Internal error: directory mismatch"
  fi

  # 7. Disallowed tools (log-level)
  DISALLOWED=$(grep -m1 -o 'DISALLOWED_TOOLS:.*' "$RUN_LOG" 2>/dev/null \
    | sed 's/DISALLOWED_TOOLS:[[:space:]]*//' || true)
  if [[ -n "$DISALLOWED" && -z "$PD_COUNT" ]] || [[ -n "$DISALLOWED" && -n "$PD_COUNT" && "$PD_COUNT" -eq 0 ]]; then
    add_finding "$RUN_ID" "disallowed_tools" "info" "Disallowed tools detected" "$DISALLOWED"
  fi

  # 8. Action not found
  if grep -q "Can't find 'action.yml'" "$RUN_LOG" 2>/dev/null; then
    add_finding "$RUN_ID" "action_not_found" "error" "Missing action.yml" "action.yml not found"
  fi

  # 9. GraphQL user error
  if grep -qE 'Failed to fetch user display name.*GraphqlResponseError' "$RUN_LOG" 2>/dev/null; then
    add_finding "$RUN_ID" "graphql_user_err" "warning" "GraphQL user fetch failed" "GraphqlResponseError"
  fi

  # 10. Rate limited (all 3 attempts)
  CHECKS=$(grep -c 'is_rate_limited=true' "$RUN_LOG" 2>/dev/null || true)
  if [[ "$CHECKS" -ge 3 ]]; then
    add_finding "$RUN_ID" "rate_limited" "error" "All 3 attempts rate limited" "All attempts hit 429"
  fi

  # 11. Uncategorized errors (fallback)
  UNCATEG=$(grep -E '##\[error\]|Error:|ERR_TEST_FAILURE|"is_error".*true|^fatal:' "$RUN_LOG" 2>/dev/null \
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

  rm -f "$RUN_LOG"
done < "$RUNS_ROWS_FILE"

UNIQUE_FINDING_RUNS=0
if [[ -s "$RUNS_WITH_FINDINGS" ]]; then
  UNIQUE_FINDING_RUNS=$(sort -u "$RUNS_WITH_FINDINGS" | wc -l | tr -d ' ')
fi

# --- Output ---
if $JSON_OUTPUT; then
  CATEGORIES_JSON="{}"
  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in $(ls "$TMPDIR/cats"/*.ids 2>/dev/null | sort); do
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
    --argjson scanned_failed "$SCANNED_FAILED" \
    --argjson runs_with_findings "$UNIQUE_FINDING_RUNS" \
    --argjson claude_only "$CLAUDE_ONLY" \
    --argjson categories "$CATEGORIES_JSON" \
    '{ analyzed_at: $analyzed, total_runs: $total, scanned_failed: $scanned_failed, runs_with_findings: $runs_with_findings, claude_only: $claude_only, categories: $categories }'
else
  echo ""
  echo "=== Claude workflow failures ($UNIQUE_FINDING_RUNS runs with findings / $SCANNED_FAILED failed runs scanned / $TOTAL runs listed) ==="
  echo ""

  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in $(ls "$TMPDIR/cats"/*.ids 2>/dev/null | sort); do
      [[ -f "$CAT_FILE" ]] || continue
      CAT=$(basename "$CAT_FILE" .ids)
      COUNT=$(wc -l < "$CAT_FILE" | tr -d ' ')
      if [[ "$SCANNED_FAILED" -gt 0 ]]; then
        PCT=$((COUNT * 100 / SCANNED_FAILED))
        echo "  $CAT: $COUNT runs ($PCT% of scanned failures)"
      else
        echo "  $CAT: $COUNT runs"
      fi
    done
  else
    echo "  No Claude failure patterns found."
  fi

  echo ""
  echo "--- Details per category ---"
  echo ""

  if ls "$TMPDIR/cats"/*.ids 1>/dev/null 2>&1; then
    for CAT_FILE in $(ls "$TMPDIR/cats"/*.ids 2>/dev/null | sort); do
      [[ -f "$CAT_FILE" ]] || continue
      CAT=$(basename "$CAT_FILE" .ids)
      RUNS=$(sort -u "$CAT_FILE" | tr '\n' ' ')
      echo "[$CAT]"
      echo "  Runs: $RUNS"
      echo "  Sample details:"
      DETAILS_FILE="${CAT_FILE%.ids}.details"
      if [[ -f "$DETAILS_FILE" ]]; then
        head -2 "$DETAILS_FILE" | while IFS= read -r LINE; do
          [[ -n "$LINE" ]] && echo "    - $LINE"
        done
      fi
      echo ""
    done
  else
    echo "  (no failure details to show)"
  fi
fi
