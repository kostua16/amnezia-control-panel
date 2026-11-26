# PR #1251 review fixes: summary

Completed 2026-11-26. Plan: [PLAN.md](PLAN.md).

## Decisions

- **Phase 999 scope.** Phase 999 stays a reserved queue phase outside milestone progress, matching how GSD 1.23.0 treats the `999` sentinel. Milestone progress covers Phases 13.1-13.4 (4 of 4 phases, 4 of 4 plans, 100%). The queue tally (50 of 114) lives on the `Execution queue:` line in `STATE.md` and the Phase 999 `Plans:` line in `ROADMAP.md`.
- **Runtime patch.** On the 1.23.0 baseline, `state sync` scanned every directory under `.planning/phases/` for the legacy phase-id convention and proposed 50% (80% with only the directory filter). A two-line local patch in `.claude/gsd-core/bin/lib/state.cjs` scopes the sync scan to the milestone and excludes sentinel headings for every convention. Reapply notes: `docs/workflow-e2e-scenarios.md` → GSD runtime compatibility.
- **Activity fields.** Frontmatter uses `last_activity` plus `last_activity_desc`; the body uses `Last activity:` plus `Last Activity Description:`, so sync can refresh the date without dropping the narrative.
- **13.2 glob rewrite dropped.** `verify-summary` passes on 1.23.0 without it.

## Changes

- `chore(gsd)`: `.claude/get-shit-done` replaced by the upstream `@opengsd/gsd-core` 1.23.0 install under `.claude/gsd-core`; workflows, setup fallback pin, agents, and skills use the new paths and `/gsd-*` names. Runtime `.cjs` files match the npm release byte for byte.
- Phase 13.1-13.4 verification files renamed to `<phase>-VERIFICATION.md` with `status: passed` and a records-only `covered_digest`; each gained a 2026-11-26 re-verification note (governance check: no errors, no warnings) and historical corrections (standalone SQL guard folded into Lint; Phase 999 import owned by `gsd-planning-execute.yml`).
- Phase 13.1-13.4 summaries: `duration: unknown`, `completed: 2026-06-11` (deliverables `f169384d`, verification `2176f7ea`), 13.1 depends on Phase 12.15, and corrected ownership claims.
- `ROADMAP.md`: 13.1-13.4 checked, milestone line and Phase 999 tracking note updated; zero checkbox conflicts.
- `STATE.md`: milestone-scoped progress, separate queue line, historical labels on v1.1 metrics, repaired By Phase table, stale footer timestamp removed.

## Verification

- On disposable copies: `state sync` (second run proposes no change), `state update-progress`, and `state advance-plan` keep 4/4 = 100% and `completed_plans <= total_plans`; after a simulated queue completion the queue reads 51/114 and milestone progress is unchanged.
- In the worktree: `state json` and `roadmap analyze` agree on 4/4 complete; `state sync --verify` reports no changes; summary and verification schemas, `verify-summary`, and `verify phase-completeness` pass for all four phases; frontmatter parses with js-yaml.
- `query validate.health`: no new repository findings; four pre-existing W019 warnings for non-canonical `.planning/` files remain.

## Residual limitations

- No state writer refreshes the Phase 999 queue tally. The executor PR or maintainer that records a queue completion updates the `Execution queue:` and `Plans:` lines.
- GSD 1.23.0 ignores `--no-transition`. Per-wave Phase 999 runs are unaffected; the transition workflow runs only after the last queue plan completes.
- Archived 12.x phase directories still sit under `.planning/phases/`; `/gsd-cleanup` can move them later.
