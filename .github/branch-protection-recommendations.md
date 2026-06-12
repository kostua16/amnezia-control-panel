# Branch Protection Recommendations

Recommended protection for `main`:

- Require pull request before merging.
- Require approvals from at least one maintainer.
- Require conversation resolution before merge.
- Require status checks to pass before merge:
  - `CI / Lint`
  - `CI / Type Check`
  - `CI / Test`
  - `CI / Build`
  - `PR Policy / label-and-validate`
  - `Workflow Governance / governance` for `.github/**` changes
  - `Supply Chain Policy / validate` for `.github/**` and package manifest changes
  - `Docker Image / Docker Build` for Docker image build validation
- Require branches to be up to date before merge when GitHub queueing is unavailable.
- Restrict who can push to matching branches: repository maintainers and automation tokens only.
- Do not allow bypassing required pull requests except repository owners for emergency recovery.
- Require signed commits if all active automation identities support signing.

Repository ruleset note: workflow paths remain manual-only by policy. Planning paths are auto-merge eligible only on trusted planning branches when the diff stays under `.planning/**` and CI plus core/security review pass; ordinary `.planning/**` edits should keep `needs-review`.
