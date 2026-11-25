# CLI counter review fixes

- Count failed whole-job reports in the unavailable jobs total only. Normalize the report reason to a bounded code.
- Use deferred CLI setup in the platform fixture so it runs independently of the installed GitHub CLI.
- Require the Node preload on each Node step in the three scoped jobs and document that global flags before a CLI subcommand bypass tracing.
- Focused tests, ESLint, Prettier, actionlint, and Bash smoke passed. Both full suites reproduced the previous Windows failures without new failures. Negative fixtures confirmed the guard catches renamed jobs and unwired Node steps.
