---
type: quick
status: complete
---

# PR 1087 telemetry cutoff

- `de1b6415` validates UTC cutoffs by round trip and uses epoch milliseconds for inclusive filtering and stable ordering. Regression tests cover impossible dates, cutoff equality, and mixed timestamp precision.
- The PR already included current `main` and both workflow contract fixes. The runner and GitHub CLI authentication contract tests passed.
- The telemetry suite, lint, and targeted Prettier check passed. The two app-suite failures and eight workflow-suite failures on Windows matched the untouched PR head after checkout line endings were aligned.
