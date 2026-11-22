---
status: complete
---

# APR-I09 review fixes

Mixed-revision workflows now resolve the bot profile from their workflow SHA and pass the CSV through the legacy input. The resolver validates exact logins, and the workflow contract checks parsed YAML. Retry classification preserves fatal Git setup errors when the API probe is unreachable.

ESLint and targeted Prettier passed. On Windows, the full application and workflow suites reproduced the same 2 and 12 failures respectively on the original branch. Both added regression tests passed.
