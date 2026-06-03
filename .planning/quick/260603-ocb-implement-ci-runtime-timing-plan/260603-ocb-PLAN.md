# Quick Task 260603-ocb: Implement CI Runtime Timing Plan

## Objective

Implement the updated CI runtime tuning plan from latest `origin/main`.

## Scope

- Restore `ready_for_review` to the lightweight PR Orchestrator trigger.
- Keep heavy CI checks unchanged.
- Add workflow-health timing evidence for slow runs.
- Add same-SHA duplicate hints to guide the optimizer away from already-fixed duplicate-run classes.
- Cover the timing summarizer with focused Node test coverage.

## Verification

- `rtk actionlint`
- `rtk npm test`
- `rtk npm run lint`
- `rtk npm run format:check`
- `rtk npx tsc --noEmit`
- Targeted Prettier check for changed workflow/CJS/test/planning files.
