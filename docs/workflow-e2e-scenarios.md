# Workflow E2E Scenario Catalog

Exhaustive end-to-end scenarios for the GitHub-workflow automation stack. **Every case is a full path: trigger → terminal.** Intermediate statuses (`awaiting_checks`, `blocked`, `manual_only`, `needs-review`) are waypoints, not endpoints — each carries a resolution arm to a terminal.

This catalog is the **spec for the characterization + spec test suite** (`scripts/__tests__/e2e-*.test.cjs`, run in CI via `ci.yml:61`) and the **validation surface for every future workflow change** (see `docs/code-standards.md` → "Workflow change protocol"). Glossary: `.github/workflows/CONTEXT.md`.

## How to read

- **char** — characterization test. Locks CURRENT behavior as a green regression baseline.
- **spec** — spec test. Asserts an INTENDED invariant; may be **red today**, drives a Phase-2 fix (TDD red→green). The `P0-x` tag names the fix.
- **TR** — tracked-red. Known gap, deferred, but recorded so it is _checked_ (visible / fail-loud).
- **char [verify]** — characterization whose exact outcome must be locked during the run (a code detail not yet fully traced).
- **Valid terminals:** `merged` · `closed` · `no-op`/`reported`.
- **Human-merge rule:** `manual_only` cases terminate at **`merged (human)`** — an _external_ terminal we trust (not asserted by the scripts). The 90-day `stale→close` fallback is documented but not modeled per-case. **Issue auto-closure** (`closes #N`) is a _post-merge side-effect_ noted only on automation-merge cases, never on human-merge cases.
- **Terminal model (hybrid):** the flow-simulator asserts the **terminal decision** the scripts emit (`approve_and_enable_automerge` ⇒ merged; a stale/close condition ⇒ closed). GitHub-side completion (auto-merge, human merge, stale close) is covered by separate narrow tests (`pr-finalizer.yml:128-153` merge step; `stale.yml` 60+30-day config), not mocked.

> Case outcomes are enumerated from each flow's decision-script branches; exact outputs are **locked by the characterization run** — if a row is subtly off, the test captures the real behavior and the row is corrected then.

---

## §1 Merge gate — `pr-finalizer.yml` (+ `pr-flow.yml`)

Decision basis: `evaluate-pr-finalizer-decision.cjs` (draft / hard-block / manual-review / manual-only / metadata / check-fail / pending / ready), `required-check-evidence.cjs` (success→pass / **skipped→skip (non-blocking)** / **cancelled→cancel (blocking)** / failure→fail / missing→pending), `policy.json` (`blockingLabels`, `manualOnlyBranchPrefixes`, `manualOnlyPathGlobs`, `generatedStatePathGlobs`, `trustedPlanning.requiredPassLabels`).

```mermaid
flowchart TD
  T[trigger: pr-flow wake<br/>label/comment/check/run] --> CL[pr-flow classify]
  CL -->|draft| D[awaiting_checks]
  CL -->|hard block label| BL[blocked]
  CL -->|needs-review / manualOnly| MO[manual_only]
  CL -->|checks pending/missing| AC[awaiting_checks]
  CL -->|checks pass + trusted| RD[approve_and_enable_automerge]
  D -->|ready_for_review| CL
  BL -->|unlabeled| CL
  BL -.->|stale 90d| X1[closed]
  MO -->|maintainer unlabeled / human merge| RD
  MO -.->|stale 90d| X1
  AC -->|check completes| CL
  RD --> M((MERGED))
  X1 -->((CLOSED))
```

| ID  | Trigger / precondition                                                 | Resolution → terminal                                        | Type                                            |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| M1  | PR is draft                                                            | `ready_for_review` → orchestrate → M13                       | char                                            |
| M2  | hard block label (`do-not-merge`…)                                     | `unlabeled` → re-gate; else stale→close                      | char                                            |
| M3  | `needs-review`, non-maintainer                                         | maintainer `unlabeled` → M13; else stale→close               | char                                            |
| M4  | `needs-review`, maintainer-approved                                    | proceeds → M13                                               | char                                            |
| M5  | `manualOnlyBranchPrefixes` (`claude-audit-fix-`)                       | human merge                                                  | char                                            |
| M6  | `manualOnlyPathGlobs` (`.github/**`,`/.planning/**`)                   | human merge                                                  | char                                            |
| M7  | fork / cross-repo (untrusted scope)                                    | human merge                                                  | char                                            |
| M8  | `generatedStatePathGlobs` (`graphify-out/**`)                          | push removes files (`synchronize`)→re-gate; else close       | char                                            |
| M9  | required check **FAILED**                                              | blocked (no auto-merge)                                      | char                                            |
| M10 | required check **PENDING**                                             | check completes → M13 / M9                                   | char                                            |
| M11 | required check **SKIPPED** (job-level)                                 | `skip` bucket (non-blocking) → M13; `cancelled` still blocks | char (`required-check-evidence.cjs:86,185-191`) |
| M12 | required check **MISSING** (whole wf path-filtered out)                | today: stale→close; **after fix: → M13**                     | **spec P0-1**                                   |
| M13 | all review labels + checks pass + trusted                              | `approve_and_enable_automerge` → **merged**                  | char                                            |
| M14 | all pass + untrusted branch                                            | manual_only → human **merged**                               | char                                            |
| M15 | missing `required_pass_label`                                          | AI review runs → `labeled *-passed` → M13                    | char                                            |
| M16 | auto-merge _enablement_ fails (`gh pr merge --auto`/`--approve` error) | status=failed, reported, PR open for human                   | char                                            |
| M17 | mixed required-check states (pass + skipped + pending)                 | pending dominates → awaiting → resolves on completion        | char                                            |
| M18 | auto-merge armed, later required check goes red                        | GitHub won't merge → re-enters blocked                       | char                                            |
| M19 | `dry_run` mode                                                         | decision-only, no approve/merge/comment                      | char                                            |

---

## §2 Auto-fix loop — `fix-branch.yml` / `fix-pr.yml` / `_auto-fix-ci.yml` (+ `approve-auto-fix.yml`)

Decision basis: `workflow_run` scoped to **`workflows: ['CI']`** (`fix-branch.yml:22`, `fix-pr.yml:25`) + failure/branch/PR guards (`fix-branch.yml:40-44`, `fix-pr.yml:43-44`), `_auto-fix-ci.yml` CI-matching gate + sticky statuses (`documentation.md:91-93`), `policy.json trustedAutomationBranchPrefixes`. The fix commit is gated by `validate-pr-gate` before push; a gate failure means no push (no fix PR).

```mermaid
flowchart TD
  F[workflow_run: CI conclusion=failure] --> E{has PR?}
  E -->|no, branch main/develop| FB[fix-branch]
  E -->|yes| FP[fix-pr]
  E -->|branch claude-auto-fix-ci-*| G1[guard skip: no-op]
  E -->|non-main/develop, no PR| G2[guard skip: no-op]
  FB --> AF[_auto-fix-ci]
  FP --> AF
  AF --> CH{changes?}
  CH -->|none| NC[no-changes: reported]
  CH -->|validation fails| VF[validation-failed/push-rejected: reported]
  CH -->|fix ok| CP[commit+push → upsert PR]
  CP --> MG[merge-gate §1]
  MG -->|converges| M((MERGED))
  MG -->|still fails → re-fire| LOOP[unbounded re-fix]
  LOOP -.->|no cap today| X1[closed: stale]
```

| ID  | Trigger / precondition                    | Resolution → terminal                                                                                         | Type        |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| A1  | CI fails on `main`/`develop`, no PR       | fix-branch → `_auto-fix-ci` → fix PR → §1 → **merged**                                                        | char        |
| A2  | CI fails on a PR                          | fix-pr → `_auto-fix-ci` → push → CI re-run → §1 (**converges→merged** or **loops→A8**)                        | char        |
| A3  | CI fails on `claude-auto-fix-ci-*` branch | guard `!startsWith` → **no-op** (loop guard)                                                                  | char        |
| A4  | CI fails on non-main/develop, no PR       | branch allow-list guard → **no-op**                                                                           | char        |
| A5  | CI **passes**                             | conclusion≠failure → not triggered → n/a                                                                      | char        |
| A6  | fix produces no changes                   | sticky `no-changes` → no commit → **reported**                                                                | char        |
| A7  | fix fails CI-matching gate before push    | `validation-failed`/`push-rejected` → no push → **reported**                                                  | char        |
| A8  | fix-PR's own CI keeps failing             | capped after `maxAutoFixAttempts` (3): evaluate-trigger-policy declines further runs → **reported** (no loop) | char (P0-2) |
| A9  | maintainer `/approve` on automation PR    | approve-auto-fix → approve + auto-merge → **merged**                                                          | char        |
| A10 | non-CI workflow failure (review/dep/etc.) | fix-\* CI-scoped → **no-op** (no auto-fix)                                                                    | char        |
| A11 | fix push disables auto-merge              | bot commit needs re-review → manual → **merged**                                                              | char        |

---

## §3 AI-review label contract — `code-review`/`claude`/`antigravity(-code-review)`/`deepseek(-code-review)` (+ `dependency-review`)

Decision basis: `evaluate-trigger-policy.cjs` modes (`claude`/`antigravity`/`deepseek`/`*-review`) → `should_run`/`trusted`; secret checks (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`/`AV_API_KEY`, `ZAI_API_KEY`); label outputs (`*-review-passed`/`*-review-concerns`, `deps-review-{passed,manual,blocked}`). Provider is a **parameter** — providers sharing one label contract are one parametrized case, not duplicated.

```mermaid
flowchart TD
  C[comment /review , @provider , or dispatch] --> G[evaluate-trigger-policy]
  G -->|non-maintainer / bot| IG[ignored: no-op]
  G -->|maintainer /review| PF[pr-flow wake]
  PF --> CHK{required checks green?}
  CHK -->|no| WAIT[flow/checks-pending or failed]
  CHK -->|yes| WD[workflow_dispatch with current head_sha]
  G -->|maintainer @provider / dispatch| SE{secret present?}
  WD --> SE
  SE -->|missing| SK[skip: reported]
  SE -->|present| RV[run review]
  RV -->|clean| LP[label *-review-passed]
  RV -->|concerns| LC[label *-review-concerns]
  LP --> S1[§1 merge-gate]
  LC --> NR[needs-review → manual]
  NR -->|re-review clean| LP
```

| ID  | Trigger / precondition                                                               | Resolution → terminal                                                                                         | Type          |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------- |
| R1  | maintainer `/review` on PR after required checks are green                           | pr-flow wake → `workflow_dispatch` with current `head_sha` → review → `*-review-passed` → §1 → **merged**     | char          |
| R1b | maintainer `@provider` on PR (parametrized over provider)                            | provider review → `*-review-passed` → §1 → **merged**                                                         | char          |
| R2  | review finds concerns                                                                | `*-review-concerns` → needs-review → manual                                                                   | char          |
| R3  | non-maintainer command                                                               | `should_run=false` (concurrency "ignored" branch) → **no-op**                                                 | char          |
| R4  | bot comment                                                                          | ignored branch → **no-op** (anti-loop)                                                                        | char          |
| R5  | provider secret missing                                                              | check-secrets → skip → **reported**                                                                           | char          |
| R6  | `@provider` on an **issue** (non-PR)                                                 | interactive agent responds (issue flow, not a gate)                                                           | char          |
| R7  | `workflow_dispatch` orchestrated by pr-flow                                          | trusted → review runs → label → §1                                                                            | char          |
| R7b | manual `/review` after stale/cancelled current-head review and green required checks | stale review labels removed → Code Review redispatched by pr-flow → `flow/review-pending` until labels return | spec          |
| R8a | dependency-review: clean                                                             | `deps-review-passed` → §1 → **merged**                                                                        | char          |
| R8b | dependency-review: manual finding                                                    | `deps-review-manual` → manual (human decides)                                                                 | char          |
| R8c | dependency-review: blocked                                                           | `deps-review-blocked` → manual (human decides; **not** auto-close)                                            | char          |
| R9  | review on a **draft** PR                                                             | not orchestrated → **no-op**                                                                                  | char          |
| R11 | antigravity secret fallback (`GEMINI_API_KEY` ∥ `AV_API_KEY`)                        | runs with whichever present → label                                                                           | char          |
| R12 | review exceeds `MAX_TURNS`                                                           | truncated → label locked during run                                                                           | char [verify] |
| R13 | Kilo current-head summary says `No Issues Found`                                     | `pr-flow/kilo-review=success` → PR Flow continues                                                             | char          |
| R14 | Kilo current-head summary or inline comments contain issues                          | `pr-flow/kilo-review=failure` → `flow/review-blocked`                                                         | char          |
| R15 | Kilo issues are only on older head commits                                           | stale Kilo findings ignored → waits/passes based on current-head signal                                       | char          |
| R16 | Kilo check is cancelled/skipped                                                      | `pr-flow/kilo-review=N/A` → PR Flow continues                                                                 | char          |
| R17 | no current-head Kilo reply under 30 minutes                                          | `pr-flow/kilo-review=pending` → `flow/review-pending`                                                         | char          |
| R18 | no current-head Kilo reply after 30 minutes                                          | watchdog wakes PR Flow → `pr-flow/kilo-review=N/A` → PR Flow continues                                        | char          |

---

## §4 Autonomous-PR fleet — scheduled agents (`audit-fix`, `audit-auto-prs`, `suggest-improvements`, `docs-drift`, `monitor-…runs`, `workflow-health-optimize`, `issue-catch-up`, `gsd-planning-execute`, `maintenance`)

Decision basis: common pipeline `run-zai → prepare-automation-branch → find-duplicate-automation-pr → validate-pr-gate → commit-and-push → upsert-pull-request`; lane classification `classify-audit-fix.cjs` + `evaluate-pr-policy.cjs` (safe vs manual by path/count); `find-duplicate-automation-pr.cjs` (exact / comment-only dedup). `audit-fix` / `monitor-amnezia-control-panel-github-runs` / `workflow-health-optimize` gate their push on `validate-pr-gate` (`.github/actions/validate-pr-gate`); a gate failure posts a not-pushed summary instead of creating a PR.

```mermaid
flowchart TD
  CR[cron tick] --> AG[agent: run-zai analysis]
  AG --> D{local diff?}
  D -->|none| ND[no diff: no-op]
  D -->|yes| DD[find-duplicate-automation-pr]
  DD -->|exact / comment-only dup| DUP[reuse existing PR: no-op]
  DD -->|no dup| CP[commit+push → upsert PR]
  CP --> LN{lane}
  LN -->|safe allow-list/within limits| SL[safe branch + audit-safe label]
  LN -->|manual paths / over limit| ML[manual branch + needs-review]
  SL --> S1[§1 merge-gate → merged]
  ML --> S1
```

| ID  | Trigger / precondition                                                      | Resolution → terminal                                                                                     | Type          |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| P1  | agent diff, no duplicate (generic baseline)                                 | create PR → classify lane → §1 → **merged** / manual                                                      | char          |
| P2  | diff exactly matches open PR                                                | `duplicate_found=exact` → **no-op** (dedup)                                                               | char          |
| P3  | diff comment-only-equivalent                                                | `duplicate_found` (comment-only) → **no-op**                                                              | char          |
| P4  | no local diff                                                               | "No local diff detected" → **no-op**                                                                      | char          |
| P5  | audit-fix within safe allow-list/limits                                     | `claude-audit-safe-fix-` + `audit-safe` → auto-merge → **merged**                                         | char          |
| P6  | audit-fix over limit / manual-only paths                                    | `claude-audit-fix-` + `needs-review` → manual                                                             | char          |
| P7  | gsd-execute diff within `.planning/**` safe globs                           | trusted → §1 → **merged**                                                                                 | char          |
| P8  | gsd-execute diff outside safe globs                                         | manual-only paths → manual                                                                                | char          |
| P9  | two agents run in same window                                               | no cross-workflow gate → **multiple distinct PRs created, each → §1** (contention is the spec motivation) | **spec P0-3** |
| P10 | agent updates an existing open PR on same branch                            | upsert (not create) → §1                                                                                  | char          |
| P11 | agent comments/labels-only (e.g. issue-catch-up clusters ≥3 similar issues) | comment / label / close duplicate issues (not a PR)                                                       | char [verify] |
| P12 | dependabot PR                                                               | npm→auto; `github_actions/`→manual-only (`policy.json dependabot`)                                        | char          |
| P13 | agent commits generated state (`graphify-out/**`)                           | blocked by `generatedStatePathGlobs`                                                                      | char          |

---

## §5 Cancellation cascade — `pr-flow.yml` prt/wake concurrency

Decision basis: `pr-flow.yml:48-59` (prt vs wake **isolated** groups; `cancel-in-progress` **true** except prt `labeled`/`unlabeled`, which do not cancel — anti-thrash), `workflow-triggers.test.ts` guardrails, `documentation.md:196-260`.

```mermaid
flowchart TD
  W[wake: workflow_run/comment/dispatch] --> WG[wake group: collapse]
  PT[prt: pull_request_target] --> PG[prt group]
  PG -->|opened/sync/ready_for_review| CX[cancel older prt: restart]
  PG -->|labeled/unlabeled| NC[no cancel: anti-thrash]
  WG -.->|cannot cancel prt| PG
  WG -->|newer wake| WL[collapse to newest]
  CX --> ONE[exactly one orchestrate runs]
  NC --> ONE
  WL --> ONE
```

| ID  | Trigger / precondition                                                                | Resolution → terminal                                                                                                                                                                                                                                               | Type                                |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| C1  | prt `opened`/`synchronize`/`ready_for_review`/`reopened`                              | `cancel-in-progress=true` → newer prt cancels older (restart on new commit)                                                                                                                                                                                         | char                                |
| C2  | prt vs wake                                                                           | isolated groups (`prt-<PR#>` vs `wake-<PR#>`) → a wake can never cancel an in-flight prt                                                                                                                                                                            | char                                |
| C3  | prt `labeled`/`unlabeled`                                                             | `cancel-in-progress=false` → does NOT cancel in-flight prt (anti-thrash: orchestrate itself adds `flow/*` labels)                                                                                                                                                   | char                                |
| C4  | wake (workflow_run / comment / dispatch)                                              | `cancel-in-progress=true` → collapses to newest wake                                                                                                                                                                                                                | char                                |
| C5  | label loop (orchestrate adds `flow/*` → `labeled`)                                    | C3 ⇒ no cancel ⇒ no flood (the cascade fix)                                                                                                                                                                                                                         | char                                |
| C6  | prt terminal conclusion                                                               | must never be wrongly `cancelled` (green/skipped) — consequence of C2+C3                                                                                                                                                                                            | **spec** (PR #434 regression guard) |
| C7  | wake source parametrized (workflow_run / comment / dispatch)                          | all collapse via C4                                                                                                                                                                                                                                                 | char                                |
| C8  | worker-completion wake (e.g. Code Review `workflow_run` completed)                    | re-orchestrate → dispatch next worker                                                                                                                                                                                                                               | char                                |
| C9  | expired `pr-flow/kilo-review` pending status                                          | `pr-flow-watchdog` dispatches PR Flow so the 30-minute Kilo skip is applied                                                                                                                                                                                         | char                                |
| C10 | `auto-cover-review` scan mode (schedule / unresolved `workflow_run` / empty dispatch) | all scan-mode runs share one `auto-cover-review-scan` group (`cancel-in-progress=true`) so overlapping scans never both pass the eventually-consistent active-run check and dispatch duplicate `fix-review` runs (targeted single-PR paths still get per-PR groups) | char                                |
| C11 | per-PR fetch failure during a scan                                                    | `fetch-auto-cover-context` isolates the failed PR (skipped + recorded in manifest; not handed to the dispatch loop) so the rest of the scan completes; only the shared `fix-review` runs fetch failing or EVERY PR failing aborts the job (retry next cycle)        | char                                |

---

## §5b Commit-status visibility — `pr-flow.yml` orchestrate → `buildFlowVisibility` → `publishFlowStatuses` + `upsertFlowComment`

Decision basis: `orchestrate-pr-flow.cjs` `buildFlowVisibility` (aggregate `pr-flow/ready` + per-worker statuses), `publishFlowStatuses` (gh api `statuses/{sha}`), `upsertFlowComment` (sticky marker `<!-- pr-flow-orchestration -->`), `pr-flow.json` statuses section (contexts + descriptions). Visibility runs after dispatch+label sync; errors aggregate into status.

```mermaid
flowchart TD
  T[pr-flow wake] --> OR[orchestrate-pr-flow]
  OR --> BM[buildFlowVisibility]
  BM --> VS[visibility.orderedStatuses]
  VS --> PFS[publishFlowStatuses]
  PFS --> AG[aggregate pr-flow/ready]
  PFS --> WC[worker statuses]
  WC --> CR[codeReview/securityReview]
  WC --> DR[dependencyReview]
  WC --> KR[kiloReview]
  WC --> PI[prImprove]
  WC --> FZ[finalizer]
  OR --> UFC[upsertFlowComment]
  UFC --> CM[renderFlowComment]
  CM --> ST[sticky marker + worker table]
  AG --> PR[PR head commit status UI]
  WC --> PR
  ST --> PR
```

| ID  | Trigger / precondition                                              | Resolution → terminal                                                                                             | Type |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---- |
| V1  | Initial orchestration on draft PR                                   | aggregate=pending, all workers=pending → PR comment shows waiting state                                           | char |
| V2  | Worker completion wake (e.g., Code Review `workflow_run` completed) | re-orchestrate → buildFlowVisibility → updated statuses (codeReview=success) → PR comment refreshes               | char |
| V3  | Worker dispatch fails (`gh workflow run` error)                     | aggregate=error, relevant worker=error → status describes failure → PR comment surfaces dispatch error            | char |
| V4  | Required checks failed                                              | aggregate=failure, workers pending → `pr-flow/ready` blocks merge                                                 | char |
| V5  | Review passed (`ai-review-passed` + `security-review-passed`)       | workers=success, aggregate=pending (waiting for finalizer) → PR comment shows review success                      | char |
| V6  | Draft → ready transition                                            | statuses refresh from pending to active state → PR comment updates next steps                                     | char |
| V7  | Closed/merged PR                                                    | aggregate=success, workers=N/A → final statuses set, PR comment shows terminal state                              | char |
| V8  | Manual-only policy (`needs-review` label)                           | aggregate=success, finalizer=N/A → `pr-flow/ready` passes, PR comment shows manual-only gate                      | char |
| V9  | Visibility publish fails (gh api error)                             | error logged, aggregate status updated with error description → PR comment may stale, but status surfaces failure | char |
| V10 | Dependency review required (dependabot + package.json changed)      | dependencyReview active (not skipped), codeReview=N/A → statuses reflect dependency gate                          | char |
| V11 | Multiple workers running concurrently                               | each worker shows `running` displayState → PR comment table shows live progress                                   | char |
| V12 | External Kilo review pending (no current-head reply under 30min)    | kiloReview=pending → `pr-flow/kilo-review` status shows waiting → PR Flow continues to other gates                | char |

---

## §6a Issue → `/fix-issue` → PR — `fix-issue.yml`

Decision basis: `evaluate-trigger-policy.cjs --mode fix-issue` (`maintainerTriggeredFix` / `labelTriggeredFix`), guard `issue.pull_request == null` (`fix-issue.yml:27-33`). Push is gated by `validate-pr-gate` (`fix-issue.yml`); a gate failure means no fix PR is created.

| ID  | Trigger / precondition                | Resolution → terminal                                                                                                               | Type |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F1  | maintainer `/fix-issue` on issue      | gate → run-zai fix → `claude-fix-issue-` PR (body `closes #N`) → §1 → **merged** _(side-effect: linked issue auto-closes on merge)_ | char |
| F2  | non-maintainer `/fix-issue`           | `should_run=false` → **no-op**                                                                                                      | char |
| F3  | fix-trigger label on issue            | label-triggered fix → PR → §1 → **merged**                                                                                          | char |
| F4  | fix produces no changes               | `no-changes` → **reported**                                                                                                         | char |
| F5  | fix validation fails                  | `push-rejected`/`validation-failed` → **reported**                                                                                  | char |
| F6  | `/fix-issue` on a **PR-linked** issue | `pull_request==null` guard → **no-op**                                                                                              | char |

## §6b GSD `/plan` → PR (+ execute) — `gsd-planning.yml` / `gsd-planning-execute.yml` / `planning-intake-repair.yml`

Decision basis: `evaluate-pr-policy.cjs` `gsdExecution` (`safeAllowedPathGlobs`, `manualOnlyPathGlobs`), `policy.json trustedPlanning` (`.planning/**`, `requiredPassLabels`). Lane classification for execute-PRs is shared with §4 P7/P8.

| ID  | Trigger / precondition                           | Resolution → terminal                                                        | Type          |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------- |
| G1  | maintainer `/plan` / dispatch on issue           | plan → `claude-planning-pr-` PR (`.planning/**`) → trusted → §1 → **merged** | char          |
| G2  | planning PR touches paths outside `.planning/**` | manual-only paths → manual                                                   | char          |
| G3  | `gsd-planning-execute` cron (6h)                 | execute run → execute PR created (lane classified per P7/P8) → §1            | char          |
| G4  | execute validation fails                         | `continue-on-error` loops → report-failure or commit _(lock during run)_     | char [verify] |
| G5  | `/planning-rename-milestones`                    | `planning-intake-repair` → commit/PR                                         | char          |

## §6c Release → release-notes — `release-notes.yml`

Decision basis: release trigger → `run-zai` → notes (not a PR-merge flow).

| ID  | Trigger / precondition | Resolution → terminal                                                                           | Type          |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------- | ------------- |
| N1  | release published      | `run-zai` → notes posted _(target: release/PR-comment/asset — lock during run)_ → **published** | char [verify] |
| N2  | ZAI fails during notes | report-failure → **reported**                                                                   | char          |

## §6d `/fix-review` · `/address-review` → PR — `fix-review.yml`

Decision basis: `fix-review.yml` issue_comment (`/fix-review`,`/address-review`) + `workflow_dispatch`; concurrency "ignored" branch; ZAI address-review → commit. Distinct command-driven fix flow (not folded into §3). Push is gated by `validate-pr-gate` (`id: gate`); a `detect-noop` step skips the gate+push and posts `renderNoChanges` when the agent changed nothing. A gate failure posts a dual-block summary (agent-reported vs authoritative gate) and does not push.

```mermaid
flowchart TD
  C[/fix-review , /address-review , dispatch/] --> G{maintainer?}
  G -->|no| IG[ignored: no-op]
  G -->|yes| RC{review comments to address?}
  RC -->|none| NC[no-changes: reported]
  RC -->|yes| ZAI[run-zai address review]
  ZAI --> V{validation ok?}
  V -->|no| VF[push-rejected: reported]
  V -->|yes| CP[commit → §1 → merged]
```

| ID   | Trigger / precondition                           | Resolution → terminal                                                                                  | Type |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---- |
| FR1  | maintainer `/fix-review`/`/address-review` on PR | ZAI address review → detect-noop → validate-pr-gate → commit → §1 → **merged**                         | char |
| FR2  | non-maintainer command                           | ignored branch → **no-op**                                                                             | char |
| FR3  | no review comments to address                    | `no-changes` → **reported**                                                                            | char |
| FR4  | ZAI fix fails validation                         | `push-rejected` → **reported**                                                                         | char |
| FR5  | agent changed nothing (no findings / clean tree) | `detect-noop` `has_changes=false` → `renderNoChanges`, no push → **reported**                          | char |
| FR6  | `validate-pr-gate` fails                         | dual-block summary (agent-reported vs authoritative gate), not pushed → **reported** (re-run to retry) | char |
| FR7  | internal AI/security concerns on an eligible PR  | `auto-cover-review` dispatches `fix-review` automation mode → gated push → §3 review rerun             | char |
| FR8  | Kilo-only current-head blocker                   | `auto-cover-review` dispatches `fix-review` automation mode → gated push → §3 review rerun             | char |
| FR9  | manual-only PR with review blockers              | repair is allowed, but finalizer/auto-merge stay blocked by manual-only policy                         | char |
| FR10 | auto-cover attempt cap reached                   | no new `fix-review` dispatch → **reported/no-op**                                                      | char |
| FR11 | active current-head `fix-review` run exists      | no duplicate dispatch → **no-op**                                                                      | char |

---

## §6e `/rebase` → PR (branch refresh) — `rebase-pr.yml`

Decision basis: `rebase-pr.yml` issue_comment (exact body `/rebase`) + `workflow_dispatch` (`pr_number`, `head_sha`, `dry_run`); concurrency "ignored" branch (mirrors §6d); `evaluate-trigger-policy.cjs --mode rebase-pr` (maintainer-only, PR-only, exact command — rejects prose and `/rebase main`). A **branch-refresh** tool, never a merge tool: it rewrites the SAME PR branch and republishes it with `--force-with-lease`. Eligibility is intentionally narrower than merge: only `do-not-merge` blocks a rebase (`manual-only` / `needs-review` / `ai-review-concerns` / `security-review-concerns` block merge, not refresh). `git rebase origin/<base>` runs first; **clean rebases validate + push with no AI**. `run-zai` (opus) is invoked only when Git enters a conflict state, with review feedback pre-fetched so the agent can preserve/address findings touched by conflicts. Push is gated by `validate-pr-gate` (`id: gate`); a gate failure posts a dual-block summary and does not push. A clean no-op (head already current) skips the gate+push and reports `complete` with `pushed=false`.

```mermaid
flowchart TD
  R[/rebase , dispatch/] --> G{maintainer, PR, exact command?}
  G -->|no| IG[ignored: no-op]
  G -->|yes| E{eligible? open, same-repo, not draft, no do-not-merge}
  E -->|no| SK[skipped: reported]
  E -->|yes| RB[git rebase onto base]
  RB --> S{rebase state?}
  S -->|conflict| ZAI[run-zai opus resolve conflicts]
  S -->|failed| FL[failed: reported]
  ZAI --> V2{rebase complete?}
  V2 -->|no| FL
  S -->|clean| M{head moved?}
  V2 -->|yes| M
  M -->|no| NO[complete pushed=false: reported]
  M -->|yes| V{validate-pr-gate ok?}
  V -->|no| VF[validation-failed: reported]
  V -->|yes| P{dry-run?}
  P -->|yes| DR[complete dry-run: reported]
  P -->|no| FW[force-with-lease push, disable automerge, wake pr-flow to §1]
```

## §7 Stale PR consolidation — `merge-pr.yml`

Decision basis: `run-merge-pr-selection.cjs` (collect → `selectStalePrs`/`groupStalePrs` from `merge-pr-logic.cjs`), `collect-stale-pr-feedback.cjs` (multi-PR review-debt bundle), `merge-pr-close-guard.cjs` (source closure preconditions), `upsert-merge-pr-report.cjs` (central issue + step summary). Policy: `policy.json` labels `fresh/stale`, `fresh/consolidation-candidate`, `fresh/superseded`, `stale-pr-consolidation`; `claude/stale-pr-merge-*` is intentionally **not** a trusted auto-finalize prefix, so replacement PRs terminate at `flow/manual-only` (human merge). See `.planning/ideas/merge-pr-plan.md`.

> Ships **dry-run/report-only**; the write/close path (run-zai -> validate -> push -> open -> close) is **deferred to Rollout 5-7** and not present in the workflow yet — it requires a least-privilege agent job, a deferred `workflow_run` close, and replacement-PR dedup. See `.planning/ideas/merge-pr-plan.md`.

```mermaid
flowchart TD
  T[trigger: workflow_dispatch dry_run] --> CL[collect open PRs]
  CL --> SL[selectStalePrs: age/state/label filter]
  SL --> GR[groupStalePrs: kind-strict buckets]
  GR -->|no safe group| RPT[report only]
  GR -->|safe group, dry_run=true| RPT
  GR -->|safe group, dry_run=false| FB[collect feedback bundle]
  FB --> ZAI[run-zai build branch]
  ZAI --> VG[validate-pr-gate]
  VG -->|fail| RPT2[report, sources open]
  VG -->|pass| PU[commit-and-push + open replacement PR]
  PU --> CG[merge-pr-close-guard]
  CG -->|not green / conditions unmet| KEEP[sources left open]
  CG -->|all conditions met| CLOSE[close + label fresh/superseded]
  RPT -->((reported))
  RPT2 -->((reported))
  KEEP -->((reported))
  CLOSE -->((closed))
```

| ID  | Trigger / precondition                                                                 | Resolution → terminal                                                                 | Type                                                  |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| RB1 | maintainer `/rebase` on open same-repo PR, clean rebase                                | validate-pr-gate → `--force-with-lease` push → disable auto-merge → wake pr-flow → §1 | char                                                  |
| RB2 | non-maintainer / bot / prose / `/rebase main` / non-PR comment                         | ignored branch → **no-op**                                                            | char                                                  |
| RB3 | ineligible PR (closed, merged, draft, cross-repo, `do-not-merge`, stale dispatch head) | `skipped` → **reported**                                                              | char                                                  |
| RB4 | clean rebase, head already current (no-op)                                             | gate+push skipped → `complete` `pushed=false` → **reported**                          | char                                                  |
| RB5 | rebase enters conflict                                                                 | run-zai (opus) resolves → validate-pr-gate → `--force-with-lease` push → §1           | char                                                  |
| RB6 | conflict unresolved / run-zai fails / git error                                        | rebase aborted → `failed` → **reported**                                              | char                                                  |
| RB7 | `validate-pr-gate` fails                                                               | dual-block summary (agent-reported vs authoritative gate), not pushed → **reported**  | char                                                  |
| RB8 | `--force-with-lease` rejected (branch advanced / protection)                           | `push-rejected` (no plain-force retry) → **reported**                                 | char                                                  |
| RB9 | `dry_run` dispatch                                                                     | validate-pr-gate → `complete` `dry-run` (not pushed) → **reported**                   | char                                                  |
| MP1 | `dry_run=true` (default)                                                               | select + group + report; no push/open/close → **reported**                            | char                                                  |
| MP2 | no `consolidate` group (only rebase-first / manual-review / report-only)               | report selected + skipped reasons → **reported**                                      | char                                                  |
| MP3 | safe group + `dry_run=false`                                                           | feedback → run-zai → validate → push → open replacement (`flow/manual-only`) → guard  | **spec** (write path inert until Rollout activation)  |
| MP4 | `validate-pr-gate` fails after run-zai                                                 | not pushed, sources stay open → **reported**                                          | char                                                  |
| MP5 | replacement not yet green at guard time                                                | `canCloseSourcePr=false` → sources **left open**                                      | spec (guard enforces; runtime-verified on activation) |
| MP6 | workflow PR + app-code PR both stale                                                   | grouped into **separate** kinds, never consolidated together                          | char (`merge-pr-logic.cjs` unit tests)                |
| MP7 | dependency PR group                                                                    | `recommended_action=manual-review` → reported, not consolidated                       | char                                                  |

---

## Cross-cutting

| ID   | Scenario                                                                                             | Current behavior                                                                                                                        | Intended                                          | Type                        |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------- |
| TR-1 | **Maintainer review-approval wake** — `needs-review` PR, maintainer submits GitHub _review approval_ | `review-approved.yml` (#479) records `maintainer-approved` on an approved maintainer review → pr-flow wakes on the `labeled` event → §1 | char (#479, resolved)                             |
| X1   | **Config drift** — `policy.json`/`pr-flow.json` change removes a required label                      | all PRs stuck at missing-label                                                                                                          | guard: scenario suite + governance check catch it | **spec** (regression guard) |
| X2   | **`GH_PAT` expired / insufficient scope**                                                            | `upsert-pull-request`/`commit-and-push` fail → report-failure across agents                                                             | reported (no silent corruption)                   | char                        |

---

## Mapping → tests + gate

- **Test files:** `scripts/__tests__/e2e-merge-gate.test.cjs`, `e2e-autofix-loop.test.cjs`, `e2e-ai-review.test.cjs`, `e2e-autonomous-pr.test.cjs`, `e2e-cancellation.test.cjs`, `e2e-entry-flows.test.cjs` (§6a/b/c/d), plus §7 pure-logic suites `merge-pr-logic.test.cjs`, `merge-pr-close-guard.test.cjs`, `collect-stale-pr-feedback.test.cjs`, `upsert-merge-pr-report.test.cjs`. YAML/trigger invariants extend `src/lib/__tests__/workflow-triggers.test.ts`.
- **Flow-simulator:** `scripts/__tests__/e2e/_simulator.cjs` — replays an event sequence through the decision scripts, asserts the terminal decision.
- **CI gate:** `ci.yml:61` (`node --test .github/workflows/scripts/__tests__/*.test.cjs`) auto-runs the suite; a flow-breaking change fails CI. Local check needs **both** `npm run test-only` **and** that scripts glob.
- **Phase 1 = all `char` green + `spec`/`TR` red, no behavior change. Phase 2 flips each `spec` green via its tagged fix.**

## Open questions (resolve during characterization)

1. ~~M11 — cancel-bucket treatment~~ **RESOLVED & SHIPPED:** skipped and cancelled are now split (`required-check-evidence.cjs:185-191`) — `skipped` → `skip` bucket, **non-blocking** (→ M13); `cancelled` → `cancel` bucket, still **blocking**. M11 is a green char case (`e2e-merge-gate.test.cjs`). M12 (a genuinely-missing check) remains a separate open item.
2. Exact `fix-issue` label-trigger set (`labelTriggeredFix` branch) — capture in F3.
3. `gsd-planning-execute` terminal on persistent validation failure (G4) — partial commit or report-only?
4. `release-notes` output target — release / PR-comment / asset? (N1)
5. ~~prt cancel matrix~~ **RESOLVED from `pr-flow.yml:57,59`:** prt `opened`/`sync` cancel (restart), prt `labeled`/`unlabeled` do NOT (anti-thrash), wakes collapse; prt/wake are isolated groups. Locked by the `workflow-triggers.test.ts` cancellation test.
