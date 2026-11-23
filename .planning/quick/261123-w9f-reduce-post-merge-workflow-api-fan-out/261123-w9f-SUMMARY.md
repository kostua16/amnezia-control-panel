---
status: complete
---

# Reduce post-merge workflow API fan-out

- Four merge windows contained 16 push-triggered runs. Docker classified all four pushes, and only one published images.
- Docker now classifies main pushes using local Git history and keeps the existing fail-open policy. Fix Issue skips closed issues before authorization and uses Node without GitHub CLI setup for its local policy check.
- Both test suites match the clean-main Windows failure lists. The workflow suite gained six passing assertions. Targeted ESLint and Prettier and the workflow governance checker passed.
