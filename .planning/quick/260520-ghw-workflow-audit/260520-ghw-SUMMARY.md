---
status: complete
task_id: "260520-ghw"
description: "GitHub workflows audit and automation roadmap"
date: "2026-05-20"
---

# Quick Task 260520-ghw: GitHub workflows audit and automation roadmap

## Summary

Audited the repository's GitHub Actions setup, including CI, review, issue triage, self-healing, and scheduled AI/GSD workflows. The highest-risk problems are privileged automation trust boundaries, silent workflow failures, and several flows whose prompts do not match the tools or permissions they actually have.

## Key Findings

- Write-capable workflows are triggerable from untrusted or weakly trusted surfaces (`@claude`, issue triage/fix, `workflow_run` auto-fix flows).
- `commit-and-push` can silently succeed after three failed push attempts.
- `perf-check.yml` can mask build failures because the pipeline never enables `pipefail`.
- `fix-issue.yml` and `issue-catch-up.yml` can escalate any `triaged` issue into a code-writing fix attempt.
- `dependency-review.yml` and `release-notes.yml` ask the model to do work it is not allowed to perform.
- `setup-environment` installs mutable remote code (`@latest`, `master`, `curl | sh`) in critical workflows.
- `documentation.md` and `dependabot.yml` have drift from the current implementation and current GitHub feature set.

## Recommended Next Moves

1. Gate or disable the privileged automation flows until trust boundaries are explicit.
2. Fix the mechanical workflow bugs (`commit-and-push`, `perf-check`, review-state conflicts).
3. Replace PAT-centric automation with a GitHub App token strategy where possible.
4. Add a planning-only Claude+GSD improvement flow before adding any new self-writing automation.

## Artifacts

- Audit roadmap: `.planning/quick/260520-ghw-workflow-audit/260520-ghw-PLAN.md`
