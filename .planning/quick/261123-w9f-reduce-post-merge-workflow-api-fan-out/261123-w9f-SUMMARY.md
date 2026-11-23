---
status: complete
---

# Reduce post-merge workflow API fan-out

- Four merge windows contained 16 push-triggered runs. Docker classified all four pushes, and only one published images.
- Docker now classifies main pushes using local Git history and keeps the existing fail-open policy. Fix Issue skips closed issues before authorization and uses Node without GitHub CLI setup for its local policy check.
- Both test suites match the clean-main Windows failure lists. The workflow suite gained six passing assertions. Targeted ESLint and Prettier and the workflow governance checker passed.

Review follow-up: the classifier fetches only the push base and uses a bounded two-dot diff. Fix Issue restores quota snapshots and checks live state before repair. The test suites still match the baseline failure lists, and five more workflow test entries pass.

Second review follow-up: the classifier masks the encoded credential and handles a missing rewind base. Fix Issue retries unreadable state, continues after a warning if both attempts fail, and explicitly guards umbrella writes. Seven more workflow test entries pass with the same baseline failures.

Third review follow-up: Fix Issue skips missing issues, stops on permanent lookup failures, and retries only transient failures. Docker retains redacted fetch diagnostics and the Git fixture pins remote upload settings. Eleven more workflow test entries pass with the same baseline failures.

Fourth review follow-up: Fix Issue keeps state output separate from diagnostics and retries quota and abuse-detection responses. Docker caps redacted fetch details at 300 characters.
