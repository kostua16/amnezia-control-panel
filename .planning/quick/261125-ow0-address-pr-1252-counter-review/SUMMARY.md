---
status: complete
---

# Address the CLI counter review

Expanded built-in CLI coverage, preserved quota-probe exclusions, and made unavailable CLI coverage explicit in job reports. Restored the job trust-boundary guidance and added regression coverage for setup and stderr filtering.

Both Windows test suites reproduced their previous failure sets. Focused tests, ESLint, Prettier, actionlint, and the strict Bash missing-Node smoke test passed.
