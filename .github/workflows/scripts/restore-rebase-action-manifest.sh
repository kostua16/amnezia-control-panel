#!/usr/bin/env bash
set -euo pipefail

original_head_file="${RUNNER_TEMP:?}/original-head.txt"
if [ ! -f "$original_head_file" ]; then
  exit 0
fi

original_head="$(cat "$original_head_file")"
if ! git rev-parse -q --verify "$original_head^{commit}" >/dev/null; then
  echo "::warning::original-head.txt does not identify a commit; skipping manifest restore"
  exit 0
fi

# setup-environment starts before rebase. ZAI starts during rebase and
# also uses log-rate-limit, so preserve the shared action if ZAI ran.
paths=(.github/actions/setup-environment/action.yml)
case "${1:-skipped}" in
  skipped) paths+=(.github/actions/log-rate-limit) ;;
esac

for path in "${paths[@]}"; do
  if ! git cat-file -e "$original_head:$path" 2>/dev/null; then
    echo "::warning::$path absent from original head; skipping its restore"
    continue
  fi

  # Keep the index and worktree in sync. HEAD stays at the rebased commit.
  if ! git restore --source="$original_head" --staged --worktree -- "$path"; then
    echo "::error title=Rebase cleanup failed::Could not restore $path to $original_head"
    exit 1
  fi
done
