---
name: kos-issue-triage-inbox
description: Triage incoming and orphaned/stale GitHub issues — label, route, close-as-duplicate, or escalate — the shared discipline of the triage and issue-catch-up workflows.
user-invocable: true
when_to_use: "When the triage workflow handles a new issue, or the issue-catch-up workflow processes orphaned/stale issues on schedule."
category: utilities
argument-hint: "[issue-number or 'orphans']"
keywords: [triage, inbox, issues, orphaned, stale, labeling, routing, catch-up]
related: [kos-gh-automation-tooling, kos-claude-turn-budget, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from triage.yml (/gsd:inbox) + issue-catch-up.yml (orphaned issues) prompts
  license: repo
  version: "1.0"
---

# Idea

Two workflows share issue-handling: `triage` (`/gsd:inbox` on a new issue — label/route it) and `issue-catch-up` (scheduled sweep of orphaned/stale issues — analyze and act). Both succeed reliably when they make a **decisive, low-touch** action: assign the right label, link a duplicate, escalate a real bug, or close a stale thread. They waste runs when they over-analyze or take no action. The skill is the routing table + the courage to act.

## When to invoke this skill directly

- A new issue arrived and needs triage.
- The scheduled sweep is processing orphaned/stale issues.

## References

- `triage.yml` prompt (`/gsd:inbox`, ISSUE NUMBER/TITLE/BODY/AUTHOR).
- `issue-catch-up.yml` prompt ("Analyze and Act on Orphaned Issues").
- `policy.json` label set + `ensure-workflow-labels.cjs` (valid labels only).
- `gh issue edit/view/comment/label/create`.

## Communication Style

Per issue: one action (LABEL / CLOSE-DUPLICATE / ESCALATE / NEEDS-INFO) + one-line reason. Batch summary at the end.

## Core Principles

YAGNI / KISS / DRY. Lowest-touch correct action. Do not draft a fix here (that's fix-issue). Act on the issue object, cite the rule.

## Routing table

| Issue shape | Action |
|---|---|
| Bug with clear repro | label `bug`; route to a phase/backlog; escalate if critical |
| Question / usage | label `question`; answer or link docs; close if resolved |
| Duplicate | label `duplicate`, link canonical, close |
| Feature request | label `enhancement`; `/gsd:capture` seed |
| Stale (90d+, no activity) | label `stale`; close if no response, else keep |
| Unlabeled orphan | assign best-fit label; ensure it has an owner/phase |
| Spam / invalid | close `invalid` |

## Your Approach

1. Read title+body+author+comments.
2. Match a routing row.
3. Apply the action via `gh issue` (label/close/comment).
4. If it needs implementation, leave it for `fix-issue`/planning — don't fix here.

## Process Flow (Authoritative)

1. For each issue: classify → action → reason.
2. Apply via `gh issue edit/label/comment/close`.
3. For sweeps: group actions; report counts.
4. Never edit code; never open a PR from triage.

## Output Format

```
ISSUE #<n>: <action> — <reason>
SWEEP (catch-up): labeled=a closed=b escalated=c orphans-remaining=d
```

## Critical Constraints

- Use only labels defined in `policy.json` (ensure-workflow-labels).
- Never fix the issue here — that's a separate workflow; triage routes, it doesn't build.
- A decisive wrong-ish label is recoverable; paralysis is not — act, then correct.
