---
name: kos-dependency-pr-review
description: Review a Dependabot dependency-update PR using only local repository context — assess compatibility, breaking changes, and security, then approve/request-changes, and wake the orchestrator safely.
user-invocable: true
when_to_use: "When the dependency-review workflow reviews a Dependabot PR, or when wiring/repairing its wake-orchestrator step."
category: utilities
argument-hint: "[pr-number]"
keywords: [dependabot, dependency, review, compatibility, breaking-change, supply-chain]
related: [kos-gh-automation-tooling, kos-zai-run-failure-prevention, kos-claude-turn-budget]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from dependency-review.yml prompt (local-context-only dep review)
  license: repo
  version: "1.0"
---

# Idea

`dependency-review` runs an AI review of a Dependabot PR using **only local repository context** — no external lookups. The value is a fast, grounded compatibility/breaking-change/security read. Most runs succeed (13 success / 1 skip). The skill keeps the review focused, local, and decisive (approve or request-changes), and posts the outcome via wake-orchestrator without failing the run on a tolerated non-zero exit.

## When to invoke this skill directly

- You are reviewing a Dependabot/dependency-update PR.
- You need to decide approve vs. request-changes on a version bump.

## References

- `dependency-review.yml` prompt ("Review this Dependabot dependency update PR using only local repository context").
- Local signals: `package.json` / `package-lock.json`, `src/` usages of the dep, changelog/release notes if vendored, type defs.
- `evaluate-pr-policy.cjs` / `orchestrate-pr-flow.cjs` (wake-orchestrator path).
- Companion workflows: `dependency-review.yml` (GitHub's own), `supply-chain.yml`.

## Communication Style

One verdict (APPROVE / REQUEST_CHANGES) + the 1–3 risks that drive it, each cited to local code.

## Core Principles

YAGNI / KISS / DRY. Local context only — do not fetch the internet. Decide; don't hedge. A patch/minor bump with no removed APIs and no usage of changed APIs → approve.

## Your Approach

1. Identify the bumped package + version delta (major/minor/patch).
2. Find usages of the package in `src/` (grep import/require).
3. Check the delta against the APIs actually used: removed/renamed/changed-signature → risk.
4. Check security advisories already known locally (audit output if present).
5. Verdict: APPROVE (low risk) or REQUEST_CHANGES (breaking/used-API changed) with specifics.

## Risk triage

| Delta | Default | Flip to REQUEST_CHANGES if |
|---|---|---|
| patch | APPROVE | advisory / regression noted locally |
| minor | APPROVE | a used API is removed/deprecated in the changelog |
| major | REQUEST_CHANGES unless verified | used API changed/removed; lockfile conflicts |

## Process Flow (Authoritative)

1. Parse the bump (package, from→to, semver class).
2. grep usages in repo.
3. Map delta to used-API risk.
4. Verdict + cited risks.
5. Post review; wake orchestrator (tolerate pre-auth non-zero exit).

## Output Format

```
BUMP <pkg> <from>→<to> (<class>)  USAGES=<n files>
RISK: <none|advisory|breaking-used-api|...>
VERDICT: APPROVE | REQUEST_CHANGES — <reasons>
```

## Critical Constraints

- Local context only; never claim a risk you cannot cite to repo code or vendored changelog.
- A major bump is REQUEST_CHANGES until explicitly verified safe — do not auto-approve.
- Do not fail the run from wake-orchestrator's tolerated non-zero exit; confirm it is pre-auth noise.
