#!/usr/bin/env bash
#
# Reconciles dependency-vulnerability tracking issues once npm audit is clean.
#
# Safety contract:
#   - Runs only when `npm audit --audit-level=high` passes (genuinely clean).
#   - Touches only OPEN issues labeled "dependencies" that are NOT already
#     "fixed" and whose title looks like a vuln/audit tracker.
#   - Marks them "fixed" with an evidence comment; does NOT auto-close (a human
#     confirms closure).
#
# Prevents stale trackers from lingering and being nagged by issue-catch-up
# after an upstream patch lands (e.g. a ws/socket.io fix the autonomous audit
# pipeline already pulled in).

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  echo "GITHUB_REPOSITORY is not set; skipping reconciliation." >&2
  exit 0
fi

# Only reconcile when there are genuinely no HIGH+ advisories.
set +e
npm audit --audit-level=high >/tmp/reconcile-audit.txt 2>&1
AUDIT_EXIT=$?
set -e
if [ "$AUDIT_EXIT" -ne 0 ]; then
  echo "npm audit still reports HIGH+ advisories; nothing to reconcile."
  exit 0
fi
echo "npm audit is clean; scanning for resolved dependency-vuln tracking issues."

# Open dependency issues that are not already marked fixed.
mapfile -t ROWS < <(gh issue list --repo "$REPO" \
  --search "is:issue is:open label:dependencies -label:fixed" \
  --json number,title --jq '.[] | "\(.number)\t\(.title)"' 2>/dev/null || true)

count=0
for row in "${ROWS[@]}"; do
  [ -n "$row" ] || continue
  num="${row%%$'\t'*}"
  title="${row#*$'\t'}"
  # Only vuln/audit trackers — skip generic dependency upgrade requests.
  case "$title" in
    *[Vv]ulnerabilit* | *[Aa]udit* | *CVE-* | *CVE[0-9]* | *GHSA-* | *[Aa]dvisory*)
      echo "-> marking #$num fixed: $title"
      gh issue edit "$num" --repo "$REPO" --add-label "fixed" >/dev/null 2>&1 || true
      gh issue comment "$num" --repo "$REPO" --body "npm audit reports 0 HIGH+ advisories as of this run; the tracked dependency vulnerabilities are resolved. Marking \`fixed\` — close at your discretion." >/dev/null 2>&1 || true
      count=$((count + 1))
      ;;
    *)
      echo "-- skipping #$num (not a vuln tracker): $title"
      ;;
  esac
done

echo "Reconciliation complete: $count issue(s) marked fixed."
