#!/usr/bin/env bash
#
# Reconciles dependency-vulnerability tracking issues once the SPECIFIC
# advisories they document are resolved in the current lockfile.
#
# Safety contract:
#   - Scope: only OPEN issues labeled "dependencies" that are not already "fixed".
#   - Evidence-based: extracts GHSA/CVE IDs from each tracker's body and marks it
#     "fixed" only when NONE of those advisories remain in `npm audit --json`.
#     Trackers with no advisory IDs in the body are left untouched (cannot verify).
#   - Marks "fixed" with an evidence comment; does NOT auto-close (human confirms).
#
# Prevents stale trackers from lingering (and being nagged by issue-catch-up)
# after an upstream patch lands, without false-positive "fixed" on unrelated or
# unfinished dependency work.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  echo "GITHUB_REPOSITORY is not set; skipping reconciliation." >&2
  exit 0
fi

# npm audit exits 1 when vulns exist (still emits valid JSON) and 2 on real
# errors; only unparseable output should stop us from reconciling.
AUDIT_JSON="$(npm audit --json 2>/dev/null || true)"
if ! printf '%s' "$AUDIT_JSON" | jq -e '.vulnerabilities' >/dev/null 2>&1; then
  echo "npm audit output is not parseable; skipping reconciliation." >&2
  exit 0
fi

# Advisory identifiers still open against the current lockfile.
OPEN_IDS="$(printf '%s' "$AUDIT_JSON" | grep -oE 'GHSA-[0-9a-z-]+|CVE-[0-9-]+' | sort -u || true)"
open_count="$(printf '%s\n' "$OPEN_IDS" | grep -c . 2>/dev/null || true)"
echo "npm audit reports $open_count open advisory id(s); scanning trackers."

# Open dependency issues not already marked fixed.
mapfile -t ROWS < <(gh issue list --repo "$REPO" \
  --search "is:issue is:open label:dependencies -label:fixed" \
  --json number,title --jq '.[] | "\(.number)\t\(.title)"' 2>/dev/null || true)

marked=0
for row in "${ROWS[@]}"; do
  [ -n "$row" ] || continue
  num="${row%%$'\t'*}"
  title="${row#*$'\t'}"

  body="$(gh issue view "$num" --repo "$REPO" --json body -q '.body' 2>/dev/null || echo '')"
  issue_ids="$(printf '%s' "$body" | grep -oE 'GHSA-[0-9a-z-]+|CVE-[0-9-]+' | sort -u || true)"

  if [ -z "$issue_ids" ]; then
    echo "-- skipping #$num (no advisory ids in body to verify): $title"
    continue
  fi

  # Any of this tracker's advisories still open?
  unresolved=""
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    if printf '%s\n' "$OPEN_IDS" | grep -qxF "$id"; then
      unresolved="${unresolved} ${id}"
    fi
  done <<< "$issue_ids"

  if [ -n "$unresolved" ]; then
    echo "-- skipping #$num (still open:${unresolved}): $title"
    continue
  fi

  resolved_list="$(printf '%s' "$issue_ids" | paste -sd ', ' -)"
  echo "-> marking #$num fixed (advisories resolved: ${resolved_list}): $title"
  if gh issue edit "$num" --repo "$REPO" --add-label "fixed" >/dev/null 2>&1; then
    gh issue comment "$num" --repo "$REPO" --body "All advisories referenced in this tracker (${resolved_list}) are absent from the current \`npm audit\`; the tracked dependency vulnerabilities are resolved. Marking \`fixed\` — close at your discretion." >/dev/null 2>&1 || true
    marked=$((marked + 1))
  else
    echo "   label application failed for #$num; not counted"
  fi
done

echo "Reconciliation complete: $marked issue(s) marked fixed."
