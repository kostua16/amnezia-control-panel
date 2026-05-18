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

# --- Pattern definitions ---
# Each: category_name severity regex
# Matched in order — first match wins for a given line.
KNOWN_PATTERNS=(
  "permission_denials warning  \"permission_denials_count\": ([1-9]\d*)"
  "git_push_403      error    fatal: unable to access.*returned error: 403"
  "graphql_pr_fail   error    pull request create failed: GraphQL:"
  "turn_limit_hit    error    \"num_turns\": (\d+)"
  "zero_turns        error    \"num_turns\": 0"
  "internal_error    warning  Internal error: directory mismatch"
  "disallowed_tools  info     DISALLOWED_TOOLS: (.*)"
  "action_not_found  error    Can't find 'action\.yml'"
  "graphql_user_err  warning  Failed to fetch user display name.*GraphqlResponseError"
)

# Fallback uncategorized patterns (only checked if no known pattern matched)
UNCATEGORIZED_PATTERNS=(
  "uncategorized error   ##\[error\](.*)"
  "uncategorized error   ^\s*Error:\s+(.+)"
  "uncategorized error   ERR_TEST_FAILURE"
  "uncategorized error   exit code ([1-9]\d*)"
  "uncategorized error   \"is_error\":\s*true"
  "uncategorized error   ^fatal:\s+(.+)"
  "uncategorized error   Process completed with exit code ([1-9])"
)

# --- Accumulators ---
declare -A CAT_COUNTS   # category -> count of runs with this category
declare -A CAT_RUNS     # category -> newline-separated list of run ids
declare -A CAT_DETAILS  # category -> newline-separated detail snippets
TOTAL=0

# --- Fetch runs ---
echo "Fetching $LIMIT completed runs..." >&2
RUNS_JSON=$(gh run list --limit "$LIMIT" --json databaseId,status,conclusion,name --jq \
  '[.[] | select(.status == "completed" and .conclusion != "cancelled")]')

RUN_COUNT=$(echo "$RUNS_JSON" | jq 'length')
echo "Analyzing $RUN_COUNT runs..." >&2

# --- Process each run ---
for ROW in $(echo "$RUNS_JSON" | jq -c '.[]'); do
  RUN_ID=$(echo "$ROW" | jq -r '.databaseId')
  CONCLUSION=$(echo "$ROW" | jq -r '.conclusion')
  WF_NAME=$(echo "$ROW" | jq -r '.name')
  TOTAL=$((TOTAL + 1))

  # Only analyze failures for patterns (success runs contribute to totals only)
  if [[ "$CONCLUSION" != "failure" ]]; then
    continue
  fi

  echo "  Scanning run $RUN_ID ($WF_NAME)..." >&2

  LOG=""
  LOG=$(gh run view "$RUN_ID" --log 2>/dev/null) || continue

  declare -A RUN_FINDINGS  # category -> detail (first match per category)
  HAS_FINDING=false

  # Check for claude-execution-output.json content in logs
  EXEC_JSON=$(echo "$LOG" | grep -oP '"claude-execution-output\.json.*?(?=\n\S)' | head -1 || true)

  # --- Known patterns ---
  # 1. Permission denials from JSON
  PD_COUNT=$(echo "$LOG" | grep -oP '"permission_denials_count":\s*\K[0-9]+' | head -1 || true)
  if [[ -n "$PD_COUNT" && "$PD_COUNT" -gt 0 ]]; then
    if [[ "$PD_COUNT" -gt 5 ]]; then
      SEV="error"
    else
      SEV="warning"
    fi
    DETAIL="${PD_COUNT} denials"
    RUN_FINDINGS["permission_denials"]="$SEV|$DETAIL"
    HAS_FINDING=true
  fi

  # 2. Git Push 403
  if echo "$LOG" | grep -qP 'fatal: unable to access.*returned error: 403'; then
    RUN_FINDINGS["git_push_403"]="error|Git push HTTP 403"
    HAS_FINDING=true
  fi

  # 3. GraphQL PR failure
  if echo "$LOG" | grep -qP 'pull request create failed: GraphQL:'; then
    RUN_FINDINGS["graphql_pr_fail"]="error|GraphQL PR creation failed"
    HAS_FINDING=true
  fi

  # 4. Turn limit hit
  NUM_TURNS=$(echo "$LOG" | grep -oP '"num_turns":\s*\K[0-9]+' | tail -1 || true)
  MAX_TURNS=$(echo "$LOG" | grep -oP '"max_turns":\s*\K[0-9]+' | tail -1 || true)
  IS_ERROR=$(echo "$LOG" | grep -oP '"is_error":\s*\K(true|false)' | tail -1 || true)
  if [[ -n "$NUM_TURNS" && -n "$MAX_TURNS" && "$NUM_TURNS" -eq "$MAX_TURNS" && "$IS_ERROR" == "true" ]]; then
    RUN_FINDINGS["turn_limit_hit"]="error|Turns: $NUM_TURNS/$MAX_TURNS"
    HAS_FINDING=true
  fi

  # 5. Zero turns
  if [[ -n "$NUM_TURNS" && "$NUM_TURNS" -eq 0 ]]; then
    RUN_FINDINGS["zero_turns"]="error|Zero turns used"
    HAS_FINDING=true
  fi

  # 6. Internal error
  if echo "$LOG" | grep -qP 'Internal error: directory mismatch'; then
    RUN_FINDINGS["internal_error"]="warning|Directory mismatch"
    HAS_FINDING=true
  fi

  # 7. Disallowed tools
  DISALLOWED=$(echo "$LOG" | grep -oP 'DISALLOWED_TOOLS: \K.*' | head -1 || true)
  if [[ -n "$DISALLOWED" ]]; then
    RUN_FINDINGS["disallowed_tools"]="info|$DISALLOWED"
    HAS_FINDING=true
  fi

  # 8. Action not found
  if echo "$LOG" | grep -qP "Can't find 'action\.yml'"; then
    RUN_FINDINGS["action_not_found"]="error|Missing action.yml"
    HAS_FINDING=true
  fi

  # 9. GraphQL user error
  if echo "$LOG" | grep -qP 'Failed to fetch user display name.*GraphqlResponseError'; then
    RUN_FINDINGS["graphql_user_err"]="warning|GraphQL user fetch failed"
    HAS_FINDING=true
  fi

  # 10. Rate limited (all 3 attempts)
  RUN1_FAIL=$(echo "$LOG" | grep -c 'Run Claude Code (attempt 1)' || true)
  RUN2_FAIL=$(echo "$LOG" | grep -c 'Run Claude Code (attempt 2)' || true)
  RUN3_FAIL=$(echo "$LOG" | grep -c 'Run Claude Code (attempt 3)' || true)
  CHECK_429=$(echo "$LOG" | grep -c 'is_rate_limited=true' || true)
  if [[ "$RUN1_FAIL" -gt 0 && "$RUN2_FAIL" -gt 0 && "$RUN3_FAIL" -gt 0 && "$CHECK_429" -ge 3 ]]; then
    RUN_FINDINGS["rate_limited"]="error|All 3 attempts rate limited"
    HAS_FINDING=true
  fi

  # --- Uncategorized (fallback) ---
  # Collect lines matching generic error signatures not already captured
  UNCATEG_LINES=()
  while IFS= read -r LINE; do
    LINE="$LINE"
    [[ -z "$LINE" ]] && continue
    # Skip if this line already matched a known category
    SKIP=false
    for KEY in "${!RUN_FINDINGS[@]}"; do
      DETAIL="${RUN_FINDINGS[$KEY]#*|}"
      if [[ "$LINE" == *"$DETAIL"* ]]; then
        SKIP=true
        break
      fi
    done
    $SKIP && continue
    UNCATEG_LINES+=("$LINE")
  done < <(
    echo "$LOG" | grep -E '##\[error\]|^\s*Error:\s+|ERR_TEST_FAILURE|exit code [1-9]|"is_error":\s*true|^fatal:\s+|Process completed with exit code [1-9]' | sort -u | head -3
  )

  if [[ ${#UNCATEG_LINES[@]} -gt 0 ]]; then
    DETAIL=$(printf '%s\n' "${UNCATEG_LINES[@]}" | head -3 | jq -Rs '.[0:200]' | tr -d '"')
    RUN_FINDINGS["uncategorized"]="error|$DETAIL"
    HAS_FINDING=true
  fi

  # --- Accumulate ---
  for CAT in "${!RUN_FINDINGS[@]}"; do
    COUNT=${CAT_COUNTS[$CAT]:-0}
    CAT_COUNTS[$CAT]=$((COUNT + 1))
    CAT_RUNS[$CAT]="${CAT_RUNS[$CAT]:-}
$RUN_ID"
    CAT_DETAILS[$CAT]="${CAT_DETAILS[$CAT]:-}
${RUN_FINDINGS[$CAT]#*|}"
  done

  unset RUN_FINDINGS
done

# --- Output ---
if $JSON_OUTPUT; then
  # Build JSON structure
  CATEGORIES_JSON="{}"
  for CAT in "${!CAT_COUNTS[@]}"; do
    COUNT=${CAT_COUNTS[$CAT]}
    RUNS=$(echo "${CAT_RUNS[$CAT]}" | sed '/^$/d' | jq -R . | jq -s .)
    CATEGORIES_JSON=$(echo "$CATEGORIES_JSON" | jq --arg cat "$CAT" --argjson count "$COUNT" --argjson runs "$RUNS" \
      '. + { ($cat): { count: $count, runs: $runs } }')
  done

  jq -n \
    --arg analyzed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson total "$TOTAL" \
    --argjson categories "$CATEGORIES_JSON" \
    '{ analyzed_at: $analyzed, total_runs: $total, categories: $categories }'
else
  echo ""
  echo "=== Claude CI Run Analysis ($TOTAL runs) ==="
  echo ""

  for CAT in "${!CAT_COUNTS[@]}"; do
    COUNT=${CAT_COUNTS[$CAT]}
    PCT=$((COUNT * 100 / TOTAL))
    echo "  $CAT: $COUNT runs ($PCT%)"
  done

  echo ""
  echo "--- Details per category ---"
  echo ""

  for CAT in "${!CAT_COUNTS[@]}"; do
    echo "[$CAT]"
    echo "  Runs: $(echo "${CAT_RUNS[$CAT]}" | sed '/^$/d' | tr '\n' ' ')"
    echo "  Sample details: $(echo "${CAT_DETAILS[$CAT]}" | sed '/^$/d' | head -2)"
    echo ""
  done
fi
