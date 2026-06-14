#!/usr/bin/env bash
set -euo pipefail

# Post OR update ONE inline review comment on a pull request (idempotent upsert)
# via the GitHub REST API. Allowlisted to only the pull-request-comment endpoints.
#
# Flags mirror GitHub's "create a review comment" fields — the same names the
# mcp__github_inline_comment__create_inline_comment tool uses — plus --pr:
#   --pr <n>           pull request number (or PR_NUMBER env)         (required)
#   --path <file>      relative path of the file being commented on   (required)
#   --line <n>         diff line the comment anchors to               (required)
#   --body <text>      comment body (markdown)                        (required)
#   --start_line <n>   first line of a multi-line span
#   --side RIGHT|LEFT  diff side (default RIGHT = added / + lines)
#   --commit_id <sha>  commit the comment anchors to (default: PR head SHA)
#
# Idempotent: every body gets a hidden ownership marker appended, and before
# posting the script looks for an existing comment at the same path+line that
# carries that marker. Found -> PATCH (update in place); not found -> POST
# (create). Re-running a review refreshes the comment instead of duplicating it,
# and never touches comments authored by humans or other bots.
#
# Env: GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY (owner/repo) must be set.

PR="${PR_NUMBER:-}"
FILE_PATH=""
LINE=""
BODY=""
START_LINE=""
SIDE="RIGHT"
COMMIT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)          PR="${2:-}";          shift 2 ;;
    --path)        FILE_PATH="${2:-}";   shift 2 ;;
    --line)        LINE="${2:-}";        shift 2 ;;
    --body)        BODY="${2:-}";        shift 2 ;;
    --start_line)  START_LINE="${2:-}";  shift 2 ;;
    --side)        SIDE="${2:-}";        shift 2 ;;
    --commit_id)   COMMIT_ID="${2:-}";   shift 2 ;;
    -h|--help)
      echo "Usage: $0 --pr <n> --path <file> --line <n> --body <text> [--start_line <n>] [--side RIGHT|LEFT] [--commit_id <sha>]"
      exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; exit 1 ;;
  esac
done

REPO="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO" || "$REPO" == */*/* || "$REPO" != */* ]]; then
  echo "Error: GITHUB_REPOSITORY must be set to owner/repo (got: '${REPO}')" >&2
  exit 1
fi

if [[ -z "$PR" ]];        then echo "Error: --pr (or PR_NUMBER env) is required" >&2; exit 1; fi
if [[ -z "$FILE_PATH" ]]; then echo "Error: --path is required" >&2; exit 1; fi
if [[ -z "$LINE" ]];      then echo "Error: --line is required" >&2; exit 1; fi
if [[ -z "$BODY" ]];      then echo "Error: --body is required" >&2; exit 1; fi

case "$SIDE" in
  RIGHT|LEFT) ;;
  *) echo "Error: --side must be RIGHT or LEFT (got: '${SIDE}')" >&2; exit 1 ;;
esac

if [[ -z "$COMMIT_ID" ]]; then
  COMMIT_ID="$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)"
fi

MARKER='<!-- pr-inline-comment -->'
BODY_WITH_MARKER="${BODY}

${MARKER}"

# Find an existing helper-owned comment at the same path+line (must carry our
# ownership marker, so human / other-bot comments at the same line are skipped).
existing_id="$(
  gh api "repos/${REPO}/pulls/${PR}/comments" --paginate \
    --jq '[.[] | select(.path == "'"${FILE_PATH}"'" and (.line // 0) == '"${LINE}"' and ((.body // "") | contains("'"${MARKER}"'")))] | first | .id // empty' \
    2>/dev/null | head -1 || true
)"

if [[ -n "$existing_id" ]]; then
  gh api -X PATCH "repos/${REPO}/pulls/comments/${existing_id}" \
    -f body="$BODY_WITH_MARKER" \
    --jq '.html_url'
else
  ARGS=(api "repos/${REPO}/pulls/${PR}/comments"
    -f body="$BODY_WITH_MARKER"
    -f path="$FILE_PATH"
    -F line="$LINE"
    -f side="$SIDE"
    -f commit_id="$COMMIT_ID")
  if [[ -n "$START_LINE" ]]; then
    ARGS+=(-F start_line="$START_LINE")
  fi
  gh "${ARGS[@]}" --jq '.html_url'
fi
