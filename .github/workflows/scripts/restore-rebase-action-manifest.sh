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

# The setup-environment composite runs before rebase and has nested
# post steps. Keep the manifests for run-zai and its nested composites
# as-is because the conflict resolver loads them during rebase.
manifest=.github/actions/setup-environment/action.yml
if ! git cat-file -e "$original_head:$manifest"; then
  echo "::warning::$manifest absent from original head; skipping manifest restore"
  exit 0
fi

# Restore the index too so it agrees with the worktree. HEAD still points
# to the rebased commit, so this can leave a staged change in the runner.
if ! git restore --source="$original_head" --staged --worktree -- "$manifest"; then
  echo "::error title=Rebase cleanup failed::Could not restore $manifest to $original_head"
  exit 1
fi
