---
status: complete
---

# Address the counter installer follow-up

The Node counter and CLI installer share input normalization. The composite uses the normalized setup output as its gate. Regression tests cover PATH publication and nonfatal failures against the actual composite script.

Both Windows suites reproduced their existing failures. Focused tests, ESLint, Prettier, actionlint, and the strict Bash smoke test passed.
