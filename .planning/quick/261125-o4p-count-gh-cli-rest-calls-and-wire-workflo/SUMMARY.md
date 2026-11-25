---
status: complete
---

# Count GitHub CLI requests and wire workflow jobs

- Added the Linux `gh` launcher, shared route normalization, and Node and CLI source splits for REST and GraphQL.
- Wired GitHub Script and review workflow entry points. Fix Review starts collecting before its eligibility gate.
- Checked lint, formatting, workflow YAML, the observer against real `gh`, and both full Windows suites against `origin/main`. The Linux launcher test is enabled on hosted CI.
