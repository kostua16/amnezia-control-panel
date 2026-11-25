# CLI counter review fixes

- Validate unavailable reason codes while keeping valid codes with digits parseable.
- Check exact Linux, Windows, and macOS reasons in the post-action test.
- Fail the preload test when an expected workflow or job is missing.
- Focused tests, the renamed-job fixture, ESLint, Prettier, actionlint, and Bash smoke passed. Both full suites reproduced the previous Windows failures with no new failures.
