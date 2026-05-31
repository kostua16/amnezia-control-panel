# Quick Task 260531-pol: Broaden Issue 152 Workflow Fix and Claude Reporting

## Goal

Make workflow-health failures easier to diagnose by fixing the issue #152 turn-budget problem and extending Claude reports with concrete failed-tool samples.

## Tasks

1. Update workflow-health and triage workflow YAML:
   - Reduce triage turn budget to 40.
   - Raise workflow-health optimizer turn budget to 40.
   - Tighten optimizer prompt and avoid live `gh`/`git` investigation.

2. Extend shared Claude metrics:
   - Parse capped failed-tool samples from execution JSON/log fallback.
   - Expose samples through shared actions and `report-failure`.
   - Render samples in failure reports and rolling Claude-health comments.

3. Improve workflow-health input quality:
   - Parse failed job logs with the shared Claude parser.
   - Include compact Claude summaries in `runs_data`.

4. Verify:
   - `rtk npm test`
   - targeted Prettier check for changed JS/CJS/TS files
   - `rtk npx actionlint` for changed workflow/action YAML
