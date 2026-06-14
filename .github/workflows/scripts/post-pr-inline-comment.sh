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
#   --side RIGHT|LEFT  diff side (default RIGHT = added / + lines; LEFT requires --commit_id)
#   --commit_id <sha>  commit the comment anchors to (default: PR head SHA; required for LEFT)
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

# Numeric guards: PR and LINE are interpolated into the API path / jq args, so
# they must be positive integers (rejects path-traversal and jq-syntax escapes).
if ! [[ "$PR" =~ ^[0-9]+$ ]]; then
  echo "Error: --pr must be a positive integer (got: '${PR}')" >&2; exit 1
fi
if ! [[ "$LINE" =~ ^[0-9]+$ ]]; then
  echo "Error: --line must be a positive integer (got: '${LINE}')" >&2; exit 1
fi
if [[ -n "$START_LINE" ]]; then
  if ! [[ "$START_LINE" =~ ^[0-9]+$ ]]; then
    echo "Error: --start_line must be a positive integer (got: '${START_LINE}')" >&2; exit 1
  fi
fi

case "$SIDE" in
  RIGHT|LEFT) ;;
  *) echo "Error: --side must be RIGHT or LEFT (got: '${SIDE}')" >&2; exit 1 ;;
esac

# The head-SHA default is only valid for the added/RIGHT side. A LEFT (base-side)
# comment needs a commit where the base content exists, so require an explicit
# --commit_id there instead of silently 422-ing on the head SHA.
if [[ "$SIDE" == "LEFT" && -z "$COMMIT_ID" ]]; then
  echo "Error: --side LEFT requires an explicit --commit_id (the default head SHA is only valid for RIGHT)" >&2
  exit 1
fi

if [[ -z "$COMMIT_ID" ]]; then
  COMMIT_ID="$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)"
fi

MARKER='<!-- pr-inline-comment -->'
BODY_WITH_MARKER="${BODY}

${MARKER}"

# Match only a helper-owned comment (same path+line, carrying our ownership
# marker). Values go to jq as data (--arg/--argjson), never interpolated into the
# jq program, so a path containing " cannot break the filter or return a wrong id.
existing_id="$(
  gh api "repos/${REPO}/pulls/${PR}/comments?per_page=100" 2>/dev/null \
    | jq -r --arg path "$FILE_PATH" --argjson line "$LINE" --arg marker "$MARKER" \
        '[.[] | select(.path == $path and ((.line // 0) == $line) and ((.body // "") | contains($marker)))] | first | .id // empty' \
    | head -1 || true
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
