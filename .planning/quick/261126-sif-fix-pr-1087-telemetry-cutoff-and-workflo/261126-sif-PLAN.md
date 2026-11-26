---
type: quick
status: planned
---

# Fix PR 1087 telemetry cutoff and workflow contracts

- Verify the PR branch contains current `main` and that `cost-telemetry` follows its runner and CLI authentication contracts.
- Validate `--since` with a UTC round trip and compare run timestamps numerically. Cover impossible instants, equality at the cutoff, and mixed timestamp precision in the telemetry tests and scenario catalog.
- Run the app and workflow test suites, lint, and Prettier. Commit the scoped fix and push the PR branch.
