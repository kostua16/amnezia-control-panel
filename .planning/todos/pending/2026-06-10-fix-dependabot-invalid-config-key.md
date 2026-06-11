---
created: 2026-06-10T23:09:29.203Z
title: Fix dependabot.yml invalid review-automated key
area: tooling
files:
  - .github/dependabot.yml
---

## Problem

`.github/dependabot.yml` contains `review-automated: true` which is not a valid Dependabot v2 configuration key. This will be silently ignored by GitHub, meaning the intended auto-review behavior is not actually configured.

## Solution

Remove the invalid `review-automated: true` key. If automated PR reviews are desired, configure it through proper GitHub settings or a separate workflow. Consult current Dependabot documentation for valid keys.
