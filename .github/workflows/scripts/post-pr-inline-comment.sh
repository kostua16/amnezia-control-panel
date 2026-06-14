#!/usr/bin/env bash
set -euo pipefail

# Posts ONE inline review comment on a pull request via the GitHub REST API.
# Allowlisted to POST repos/{owner}/{repo}/pulls/{n}/comments only; it refuses
# any other gh path. Used by review workflows that must post line-specific
# findings on PRs (notably workflow_dispatch runs, where claude-code-action's
# inline-comment MCP server is not initialized — upstream issue #635).
#
# Usage:
#   ./.github/workflows/scripts/post-pr-inline-comment.sh <pr_number> \
#     --path <path> --line <line> --body <body> \
#     [--start-line <n>] [--side RIGHT|LEFT] [--commit-id <sha>]
#
# Required: --path, --line, --body.
# --side defaults to RIGHT (the PR's added side, where + lines live).
# --commit-id defaults to the PR head SHA (resolved via gh pr view).
#
# Env: GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY (owner/repo) must be set.

REPO="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO" || "$REPO" == */*/* || "$REPO" != */* ]]; then
  echo "Error: GITHUB_REPOSITORY must be set to owner/repo (got: '${REPO}')" >&2
  exit 1
fi

PR_NUMBER="${1:-}"
if [[ -z "$PR_NUMBER" ]]; then
  echo "Error: pr_number is required as the first positional argument" >&2
  exit 1
fi
shift

FILE_PATH=""
LINE=""
BODY=""
START_LINE=""
SIDE="RIGHT"
COMMIT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)      FILE_PATH="${2:-}";  shift 2 ;;
    --line)      LINE="${2:-}";       shift 2 ;;
    --body)      BODY="${2:-}";       shift 2 ;;
    --start-line) START_LINE="${2:-}"; shift 2 ;;
    --side)      SIDE="${2:-}";       shift 2 ;;
    --commit-id) COMMIT_ID="${2:-}";  shift 2 ;;
    *) echo "Error: unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$FILE_PATH" ]]; then echo "Error: --path is required" >&2; exit 1; fi
if [[ -z "$LINE" ]];      then echo "Error: --line is required" >&2; exit 1; fi
if [[ -z "$BODY" ]];      then echo "Error: --body is required" >&2; exit 1; fi

case "$SIDE" in
  RIGHT|LEFT) ;;
  *) echo "Error: --side must be RIGHT or LEFT (got: '${SIDE}')" >&2; exit 1 ;;
esac

if [[ -z "$COMMIT_ID" ]]; then
  COMMIT_ID="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefOid -q .headRefOid)"
fi

# -f sends string fields; -F sends typed values (integers for line/start_line).
ARGS=(api "repos/${REPO}/pulls/${PR_NUMBER}/comments"
  -f body="$BODY"
  -f path="$FILE_PATH"
  -F line="$LINE"
  -f side="$SIDE"
  -f commit_id="$COMMIT_ID")

if [[ -n "$START_LINE" ]]; then
  ARGS+=(-F start_line="$START_LINE")
fi

gh "${ARGS[@]}"
