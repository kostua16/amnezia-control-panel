---
status: in-progress
---

# Add Temporary Fix-Review Auth Probe Workflow

Add a temporary `workflow_dispatch` auth probe to identify which credential raw
`git push` uses when updating `.github/workflows/**` from the `fix-review` path.
The probe must avoid PR #534, use `secrets.GH_PAT` exactly like `fix-review`,
upload sanitized push logs, and clean temporary branches by default.

## Tasks

- Add `.github/workflows/debug-auth-probe.yml` with four credential scenarios:
  persisted checkout direct push, non-persisted checkout direct push, explicit
  `GIT_ASKPASS`, and explicit `GIT_ASKPASS` with git auth cleanup flags.
- Log only sanitized auth state and upload each scenario's push log as an
  artifact.
- Validate the workflow with `actionlint`, targeted Prettier, workflow tests,
  `npm run test-only`, and `git diff --check`.
- Dispatch the probe once with GitHub Actions debug variables enabled, capture
  the run URL and evidence, then remove the temporary workflow after diagnosis.
