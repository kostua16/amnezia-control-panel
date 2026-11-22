# Phase 999: GH planning execution queue

Canonical GSD execution plans imported from merged `.planning/quick/**`
artifacts are written here by the `GSD Planning Execute` workflow.

Each imported plan uses a unique `wave` so scheduled automation can execute
one merged planning artifact per run, up to four runs per day.

## Completed-sources ledger

`completed-sources.json` lists imports whose queue plan was removed after a
no-op execution (the implementation was already on `main`). Each entry keeps
the `plan`, `source_artifact`, and `source_artifact_sha256` the plan carried,
so `collect-gsd-planning-intake.cjs` keeps the source retired and its slot
consumed. Add the entry in the same change that removes the queue plan.
