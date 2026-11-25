# CLI counter review fixes

- Shared the unavailable report formatter across the normal and post-step fallback paths. Reports with missing GitHub identifiers remain parseable and post-step failures appear in the CLI-unavailable tally.
- Kept CLI reason codes opaque in the summarizer and used the Node runtime platform to decide whether to check the launcher.
- Wired the Node preload for flaky workflow detection, queue starvation alerts, and orphan branch cleanup. The blocked-gate step already uses the GitHub CLI shim.
- Focused tests, targeted ESLint and Prettier, actionlint, and the strict Bash smoke checks passed. Both full suites reproduced the previous Windows failures with no new failures.
