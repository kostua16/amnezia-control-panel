# PR #1251 review fixes

Baseline: PR head `599b76d60a4d6b239e6dbb87404a3b1ab0229b8d`, with project-local `@opengsd/gsd-core` upgraded from `1.2.0` to `1.23.0` in the worktree. This plan incorporates the independent Astra, Gemini Neon, Qwen4 Max, and Opus 5.5 re-reviews. Source: [PR #1251](https://github.com/kostua16/amnezia-control-panel/pull/1251) and [issue #1246](https://github.com/kostua16/amnezia-control-panel/issues/1246).

## 0. Integrate and gate the project-local GSD upgrade

- Use `.claude/gsd-core/bin/gsd-tools.cjs`, installed flat `/gsd-*` Claude commands, and the `1.23.0` setup fallback pin. Carry the required companion `.claude/scripts/` files and verify the CLI from a clean checkout. Preserve tracked CI guard hooks and the RTK hook. Exclude machine-local settings and installer backups. Compare backed-up files against the original npm release before reapplying genuine project customizations.
- Smoke-test setup, isolated Claude guards, maintenance health, queue plan validation, and the actual Phase 999 wave invocation. Check whether `--no-transition` still has an effect and whether callers consume the now-absolute `phase_dir`. Confirm tracked paths resolve and state writes handle the new `state_head` field without unnecessary workflow churn.
- Run both workflow test suites on the Linux runner environment used by CI. Compare failures against a baseline with equivalent line endings and dependencies. Keep the upgrade independently reviewable. Gate its rollout on the Phase 999 state-writer checks below.

## 1. Fix remaining GSD progress discrepancies

- Decide the scope before patching. Prefer keeping the operational Phase 999 identifier and tracking its 50/114 queue tally separately from the governance milestone, in line with upstream's reserved phase convention. Confirm this semantic change with the maintainer. If the queue must remain in milestone progress, evaluate explicit opt-in for Phase 999 in the vendored runtime or a coordinated migration to a non-reserved phase ID. Probe any leading-version heading change separately. Qwen4 Max found that aligning the heading and STATE to a supported version still excludes Phase 999 from the totals.
- At the baseline, `state json` preserves 46%, `state sync` proposes 50%, and `update-progress` or `advance-plan` can persist 54 completed out of 4 total. Probe again with the chosen scope and normalized verification files. If necessary, share the scoped calculation across read and write paths, keeping numerator and denominator together and preserving sensible fallback behavior. Apply a narrow patch only for reproduced residuals and record how to reapply it on vendor updates.
- Match the percentage token only. Move inline counts to a separate line because sync still captures their digits when comparing progress. Keep existing plain-field support. Migrate frontmatter to `last_activity` plus `last_activity_desc` and preserve the body narrative on sync.
- In a disposable checkout compare CLI output, persisted YAML, body, and roadmap. Exercise `state sync`, `state update-progress`, and `state advance-plan`. Require `completed_plans <= total_plans`, consistent percentages, intact narrative, and no proposed progress or activity rewrite on a second sync. Repeat after a queue completion and verify cache invalidation and strict YAML parsing. If the queue is tracked separately, require the queue count to advance while governance milestone progress stays stable. Keep state writers confined to disposable copies until these checks pass.

## 2. Align the roadmap and state snapshot

- Validate the existing evidence for phases 13.1–13.4. Give the verification files GSD-recognized names and `status: passed` metadata where warranted. Update ROADMAP checkboxes and milestone status in the same change and require zero checkbox conflicts. Verify milestone name recognition and the shipped-details scope boundary. Keep the queue open and describe it according to the scope chosen above.
- In STATE, retain `Plan: N of M` and recompute milestone and queue totals from their respective artifacts. Verify direct Phase 999 lookup and plan indexing remain available even when the queue sits outside milestone progress.
- Remove the unsupported project-wide count and the raw summary-to-plan completion ratio. Label average duration, total execution time, and the last-five table with their historical scope. Repair the malformed historical table row if its intended columns are clear. Reconcile the stale footer or remove the duplicate timestamp. Preserve the recorded last-session date as a session event unless there is evidence for a newer one.
- Trace Phase 999 completion and import entry points for writers of ROADMAP and STATE. Verify whether the stored queue tally refreshes after each event. If it does not, record the remaining refresh gap and propose a follow-up with the responsible entry point. Keep the present fix focused on GSD sync and the reviewed planning records.

## 3. Repair the four retrospective summaries

- Populate required `duration` and `completed` fields using historical evidence or an explicit unknown value supported by GSD. Do not substitute commit time for completion without evidence. Match plan identifiers to repository conventions where unambiguous and replace the generic phase dependency with a verified phase reference where appropriate.
- Keep the 13.2 glob references if useful. `verify-summary` passes on 1.23.0, so the path rewrite is no longer required.
- Check each summary against the original verification artifact and git history. Clarify that the standalone SQL guard and check were historical and that the guard now runs inside Lint. Correct Phase 999 import and execution ownership to `gsd-planning-execute.yml`. Keep verification claims limited to checks supported by the original artifacts or rerun during implementation.
- Run `frontmatter validate --schema summary`, `verify-summary`, and `verify phase-completeness` for all four phases. Confirm the correction keeps the active milestone's four completed phases visible to `roadmap analyze`.

## 4. Verify and refresh the review record

- Run `state json`, `roadmap analyze`, `state sync --verify`, and `query validate.health`. Compare health output to baseline for new findings and document existing warnings separately. Validate the stored frontmatter with a strict YAML parser. Run lint and targeted Prettier on changed JavaScript/CommonJS files. If implementation changes workflow code or configuration, run both repository workflow suites and update the workflow scenario documentation for behavior changes.
- Review the final diff against issue #1246 and recheck all four reviewer reports. Update the PR description with the actual changed files, counts, verifications, and any residual limitations. Prepare a correction for the stale issue comment if an external update is authorized.
