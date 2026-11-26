---
name: kos-daily-maintenance-sweep
description: Run the daily maintenance sweep (health, security audit, progress, TODO/FIXME scan, stale issues) and create issues ONLY where findings exist — the maintenance workflow's no-spam discipline.
user-invocable: true
when_to_use: "When the maintenance workflow runs its twice-daily sweep, or when tuning what it reports."
category: utilities
argument-hint: "[category or 'all']"
keywords: [maintenance, health, security, audit, todo, fixme, stale, sweep, daily]
related: [kos-gh-automation-tooling, kos-zai-run-failure-prevention, kos-claude-turn-budget, kos-runner-disk-hygiene]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from maintenance.yml prompt (five-category sweep) + 30/30 success runs
  license: repo
  version: "1.0"
---

# Idea

`maintenance` runs twice daily: it runs a five-category sweep (health, security `npm audit --json`, progress, TODO/FIXME in recent commits, stale issues >90d), creating a GitHub issue **only** for categories with findings. It is reliably green (30/30) because it is read-mostly and creates issues conservatively. The skill preserves that: sweep, dedupe against existing issues, and never spam (no issue when a category is clean; no duplicate of an open issue).

## When to invoke this skill directly

- You are running the daily maintenance sweep.
- You are deciding which findings become issues.

## References

- `maintenance.yml` prompt (the 5 categories + create-issue rules).
- `node .claude/gsd-core/bin/gsd-tools.cjs query validate.health`, `npm audit --json`, planning state and roadmap reads, and `gh issue list`.
- `ensure-workflow-labels` (labels: `maintenance`, `security`, `ci-failure`).
- `report-failure` (only if the sweep itself fails).

## Communication Style

Per category: findings count → issue created / skipped (clean) / skipped (duplicate). End with totals.

## Core Principles

YAGNI / KISS / DRY. Issue only if findings exist AND no open duplicate. Critical security → also comment only on open PRs changing dependency manifests. Clean category = no issue (success, not failure).

## The 5 categories

1. **Planning health** — problems reported by the planning health query.
2. **Security** — `npm audit --json` HIGH/CRITICAL.
3. **Progress** — stale or blocked phases in `.planning/STATE.md` and `.planning/ROADMAP.md`.
4. **TODO/FIXME** — in commits from the last 12h.
5. **Stale issues** — open >90 days AND actively worked or recently triaged but unresolved. Skip `stale` and `keep-open`/`backlog`/`in-progress`/`umbrella-sub-issue` labels, plus umbrella/tracking title, label, and body signals (`[todo-backlog]`, `[claude-health]`, `[grouped]`; `backlog`/`epic`/`umbrella`/`tracking`/`keep-open`; “umbrella tracking issue”/“rolling issue”). Keep `deferred` eligible.

## Your Approach

1. Run each category's check.
2. For findings: search for an open issue covering it before creating a new one.
3. Create with the right label (`security`/`maintenance`) only if findings + no duplicate.
4. Critical security → comment only on open PRs changing dependency manifests.
5. Clean category → skip (no issue).

## Failure modes to avoid

- **Issue spam** → creating an issue every run for the same standing finding (dedupe first).
- **Clean-category "failure"** → no findings is a clean success; do not force an issue.
- **Missing critical escalation** → comment on HIGH/CRITICAL findings only in open PRs changing dependency manifests.
- **Disk** → fresh GitHub-hosted VM per job; keep the `npm audit --json` install footprint small (see [[kos-runner-disk-hygiene]]).

## Process Flow (Authoritative)

1. run 5 checks.
2. dedupe against open issues.
3. create labeled issues only for real, non-duplicate findings.
4. comment on critical security findings only in open PRs changing dependency manifests.
5. report totals; clean = success.

For stale-issue disposition, follow the exemptions and the age-plus-active-or-recently-triaged condition in `maintenance.yml`; the `umbrella-sub-issue` label is explicitly exempt and `deferred` is not.

## Output Format

Emit the structured JSON report defined in the maintenance workflow prompt. Include `summary`, `categories` with per-category `findings_count`, `issue_created` and optional `skip_reason`, plus `issues_created` and `critical_pr_comments`.

## Critical Constraints

- Never create a duplicate of an open issue — search first.
- Never create an issue for a clean category.
- HIGH/CRITICAL security findings must also be commented on only for open PRs changing dependency manifests.
- Ensure disk space before the install/audit step.
