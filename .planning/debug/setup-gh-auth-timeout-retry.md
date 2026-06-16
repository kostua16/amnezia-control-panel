---
status: resolved
trigger: "Monitor run 27571524700 — PR Orchestrator PR #408 workflow_run job (27570462234) failed during setup-environment"
created: 2026-06-15
updated: 2026-06-15
---

# Debug: setup-gh auth transient network timeout

## Symptoms
- Run 27570462234 (PR Orchestrator PR #408, workflow_run, 2026-06-15 19:19–19:21) failed.
- Failed step: `Run ./.github/actions/setup-environment` → `orchestrate` job, step 3.
- Exact log: `Error: Command failed with exit code 1: gh auth login --with-token --hostname github.com` / `error validating token: Get "https://api.github.com/": dial tcp 140.82.121.5:443: i/o timeout`.

## Current Focus
- hypothesis: setup-gh token validation hits api.github.com synchronously; a transient network blip on the self-hosted runner fails the whole job because require-gh-auth:true is a hard gate.
- next_action: applied — composite action now retries setup-gh once before require-gh-auth decides.

## Evidence
- 2026-06-15: gh run view 27570462234 --json jobs → orchestrate job, setup-environment step failure.
- 2026-06-15: --log-failed → `gh auth login` i/o timeout dialing api.github.com from kostua16/setup-gh@bd07f8be.
- 2026-06-15: other recent workflow_run failures (27532409050, 27531721307, 27531772253) = "Set up job" infra provisioning failure, not code-fixable.
- No monitor-window run exceeded 300s; no slow-run action needed.

## Root Cause
External `kostua16/setup-gh` action validates the token by calling `gh auth login`, which dials api.github.com. On self-hosted runners a transient TCP i/o timeout fails that validation; `require-gh-auth: true` then makes the failure fatal for the entire job. One retry absorbs the blip.

## Fix
`.github/actions/setup-environment/action.yml`:
- First `setup_gh` step: `continue-on-error: true` (non-fatal) so a transient blip is not immediately fatal.
- New `setup_gh_retry` step: runs only when first attempt failed (`steps.setup_gh.outcome == 'failure'`); its `continue-on-error` still honors `require-gh-auth`.
- "Verify gh authenticated" step now reads auth output from either `setup_gh` or `setup_gh_retry`.

Zero added cost on the success path (retry step skipped).

## Verification
- `actionlint -config-file .github/actionlint.yaml` → exit 0 (whole-repo scan, auto-detects composite action).
- `npx prettier --check .github/actions/setup-environment/action.yml` → all files formatted correctly.

## Files Changed
- .github/actions/setup-environment/action.yml
