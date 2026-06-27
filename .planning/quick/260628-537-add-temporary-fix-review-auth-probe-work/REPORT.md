# Fix-Review Auth Probe Report

## Run

- Workflow run: https://github.com/kostua16/amnezia-control-panel/actions/runs/28304513207
- Trigger ref: `main`
- Debug variables used: `ACTIONS_STEP_DEBUG=true`, `ACTIONS_RUNNER_DEBUG=true`
- Artifact download: `/tmp/auth-probe-28304513207`

## Results

| Scenario | Persisted checkout auth | Push command family | Credential config evidence | Push result |
| --- | --- | --- | --- | --- |
| `persisted-direct` | `true` | `git push origin HEAD:<branch>` | checkout `http.https://github.com/.extraheader` present | `0` |
| `no-persist-direct` | `false` | `git push origin HEAD:<branch>` | no checkout credential config keys | `0` |
| `persisted-askpass` | `true` | `GIT_ASKPASS=<set> git push origin HEAD:<branch>` | checkout `http.https://github.com/.extraheader` present | `0` |
| `persisted-askpass-clean` | `true` | `GIT_ASKPASS=<set> git -c http.https://github.com/.extraheader= -c http.extraheader= -c credential.helper= push origin HEAD:<branch>` | checkout `http.https://github.com/.extraheader` present, explicitly cleared for push | `0` |

Each scenario committed a harmless workflow file under `.github/workflows/` and
pushed it to a temporary `debug/auth-probe-28304513207-*` branch. All four pushes
were accepted by GitHub, so the credential presented in the current
`fix-review`-like path can create workflow files.

## Credential Observations

- `gh api user` resolved to `{"login":"kostua16","type":"User"}` in every
  scenario.
- `gh auth status` showed an active `GH_TOKEN` login for `kostua16`, plus an
  inactive `setup-gh-*` config login. No token values were logged.
- `GIT_ASKPASS`, `GH_TOKEN`, `GITHUB_GIT_PASSWORD`, and `GITHUB_TOKEN_VALUE`
  were present in every scenario at the probe step.
- With `persist-credentials: true`, checkout left a temporary credential config
  containing `http.https://github.com/.extraheader`.
- With `persist-credentials: false`, no git credential config keys were visible,
  but direct `git push` still succeeded because the environment had
  `GIT_ASKPASS` and `GITHUB_GIT_PASSWORD`.
- The explicit cleanup form also succeeded while clearing both extraheader keys
  and `credential.helper` for the push process.

## Interpretation

Current `main` does not reproduce PR #534's workflow-file permission rejection.
The explicit `GIT_ASKPASS` plus cleanup form succeeds, so the current
`commit-and-push` cleanup is sufficient for workflow-file updates when
`secrets.GH_PAT` is present. Direct pushes also succeeded, including the
`persist-credentials: false` case, which means checkout persistence is not the
only credential source in the current `fix-review` path.

The evidence points away from repository-level `GH_PAT` grants or a current
workflow `permissions:` block problem. The remaining plausible root cause for
PR #534 is that the failed run executed stale branch-local workflow/action code
or otherwise ran with a different runtime credential state than current `main`.

## Cleanup

- The probe workflow was removed after evidence capture.
- Temporary `debug/auth-probe-28304513207-*` branches were deleted by the workflow
  cleanup step; `git ls-remote --heads origin 'debug/auth-probe-28304513207-*'`
  returned no branches.
- Temporary repository variables `ACTIONS_STEP_DEBUG` and `ACTIONS_RUNNER_DEBUG`
  were deleted after the run and verified absent.
