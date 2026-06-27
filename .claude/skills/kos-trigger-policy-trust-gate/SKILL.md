---
name: kos-trigger-policy-trust-gate
description: Understand the authorize-job trust gate (evaluate-trigger-policy.cjs + policy.json) that decides whether a comment/issue-triggered zai workflow actually runs, and why most such runs show conclusion=skipped.
user-invocable: true
when_to_use: "When a comment/issue-triggered workflow (claude, fix-issue, fix-review, rebase-pr, gsd-planning, triage) skipped or you need to know if a trigger will be trusted."
category: utilities
argument-hint: "[workflow and trigger event]"
keywords: [trigger, policy, trust, authorize, gate, skipped, allowed-bots, non-human]
related: [kos-zai-run-failure-prevention, kos-gh-automation-tooling]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from evaluate-trigger-policy.cjs + policy.json + skipped-run analysis
  license: repo
  version: "1.0"
---

# Idea

Comment/issue/review-triggered workflows (`claude`, `fix-issue`, `fix-review`, `rebase-pr`, `gsd-planning`, `triage`) start with an `authorize` job that runs `evaluate-trigger-policy.cjs --mode <workflow> --policy-file .github/workflows/policy.json` against the event. It emits `triggered` and `trusted`. The run only proceeds when **both** are `true`; otherwise the downstream job is `skipped`. Most runs of these workflows are `skipped` — that is the gate working, not a failure.

## When to invoke this skill directly

- A triggered workflow showed `skipped` and you need to explain why / whether it should have run.
- You are deciding whether to re-trigger, and from which actor, to be trusted.
- You are editing `policy.json` trust rules or a workflow's `authorize` condition.

## References

- `.github/workflows/scripts/evaluate-trigger-policy.cjs` — the gate logic (`--mode`, `--event-path`, `--event-name`).
- `.github/workflows/policy.json` — trusted actors, allowed bots, per-mode rules.
- Each workflow's `authorize` job `if:` + the downstream `needs.authorize.outputs.triggered == 'true' && ... trusted == 'true'`.
- `@claude` mention requirement: most modes require the literal `@claude` in the comment/review/issue body.

## Communication Style

One sentence on whether the event would be triggered+trusted, then the single condition that flips it. Do not paste the whole policy.

## Core Principles

YAGNI / KISS / DRY. The gate is authoritative — do not work around it; satisfy it. `skipped` is a feature (it saves a run), not a bug to "fix."

## How the gate decides (operator view)

1. **Triggered?** — Did the event contain the required signal? Usually a literal `@claude` mention (comment/review/issue title-or-body), or the right slash command for the mode.
2. **Trusted?** — Is the actor allowed by `policy.json`? Considers `author_association` (OWNER/COLLABORATOR/MEMBER) and the allowed-bots list. Untrusted/untrusted-actor → not trusted.
3. **Both true** → downstream job runs. **Either false** → downstream `skipped` (conclusion `skipped`, not `failure`).

`non_human_actor` (a *run* failure, distinct from *skip*) happens when the gate passed the actor but the zai runtime then refused it because the bot wasn't in `run-zai: allowed-bots`. Two different allowlists: `policy.json` (gate) vs `allowed-bots` (runtime). Both must list a bot.

## Your Approach

1. Identify the event type and the actor.
2. Check the `@claude`/command signal presence → `triggered`.
3. Check the actor against `policy.json` trust for that mode → `trusted`.
4. If a bot dispatched it, confirm it is in **both** `policy.json` and `run-zai: allowed-bots`.

## Process Flow (Authoritative)

1. Read the event (comment body / issue title+body / review body).
2. Resolve `triggered` per the mode's signal rule.
3. Resolve `trusted` per `policy.json` + `author_association`.
4. Report `triggered + trusted → RUN` or which of the two is false and the one-line fix (add mention, or re-trigger as trusted actor, or extend policy).

## Output Format

```
EVENT=<type> ACTOR=<login>(<assoc>)  TRIGGERED=<yes/no:reason>  TRUSTED=<yes/no:reason>  => RUN|SKIP
```

## Critical Constraints

- Never recommend disabling the gate to force a run; extend `policy.json` deliberately instead.
- `skipped` ≠ failure; do not file a failure issue for a skipped run.
- A bot must be in both allowlists; a gate pass + runtime refusal is `non_human_actor`, a real (fixable) failure.
