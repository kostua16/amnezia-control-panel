
# Goal details

## Idea

The idea is to improve workflows by extracting knowledge from latest 30 runs and storing it into new agents and skills.

## Requirements

- [ ] each workflow shall be investigated in separate agent session, up to 2 agents in parallel
- [ ] orchestrator shall review created agents and skills and allign them (remove duplicates via merging, re-run agents if something still missing)
- [ ] for each new created agent file you should define list of skills and mention them in the agent file
- [ ] run new agent session with review (review shall strongly review new agent file and mentioned skills and confirm that it is enough for workflow improvement) per each agent file
- [ ] for each review issues spawn new fix agent session and repeat review, only when all review sessions finishes and approve then you can stop.

## Plan

- [ ] for each workflow from 'Workflows to improve' list spawn new agent session and do:
-- [ ] check latest 30 runs
-- [ ] extract all knowledge you can find:
--- [ ] repeated issues that can be stored into knowledge that will be re-used to not do again
--- [ ] missing knowledge zai consumes each time and takes time
--- [ ] incorrect behaviour that can be corrected
--- [ ] lack of knowledge missed to do something
--- [ ] etc
-- [ ] store extracted knowledge into new agent (.claude/agents/{workflow-name}.md) and new skills (many per workflow, can be shared with other workflows).
-- [ ] for each new created agent file you should define list of skills and mention them in the agent file (.claude/skills/{workflow-name}.md),
-- [ ] run new agent session with review:
--- [ ] review shall strongly review new agent file and mentioned skills and confirm that it is enough for workflow improvement,
-- [ ] extract review feedback and for found issues spawn new fix agent session to implement fixes in the agent file and skills
-- [ ] repeat review loop until all issues are fixed
-- [ ] when review session finishes without issues and with approve then you can stop work on this workflow.
- [ ] run orchestrator session to review all created agents and skills and allign them (remove duplicates via merging, re-run agents if something still missing, add new skills to the agent file if something missing)
- [ ] run final review session to review all created agents and skills and confirm that it is enough for workflow improvement
- [ ] when all workflows are processed then you can stop.

## Exit criteria

- [ ] all workflows are processed
- [ ] all agents and skills are created
- [ ] all review sessions issues are fixed
- [ ] all review sessions finishes without issues and with approve
- [ ] all agents and skills are alligned
- [ ] final review session finishes without issues and with approve

## Risks to consider and mitigate

- [ ] new agent sessions may not be able to extract all knowledge from latest 25 runs
- [ ] new agent sessions may not be able to implement fixes in the agent file and skills
- [ ] new agent sessions may not be able to review new agent file and mentioned skills and confirm that it is enough for workflow improvement
- [ ] new agent sessions may not be able to review all created agents and skills and allign them (remove duplicates via merging, re-run agents if something still missing)
- [ ] new agent sessions may not be able to review all created agents and skills and confirm that it is enough for workflow improvement
- [ ] new agent sessions may not be able to stop work on this workflow.

## Workflows to improve

workflow                                  tot   last 15 runs breakdown
────────────────────────────────────────  ───   ──────────────────────────
monitor-amnezia-control-panel-github-runs  15   ✅15
audit-auto-prs                             15   ✅15
code-review                                15   ✅15
maintenance                                15   ✅15
dependency-review                          13   ✅13
audit-fix                                  15   ⛔14 ❌1
workflow-health-optimize                   15   ✅9 ⏸6
gsd-planning-execute                       15   ✅14 ⛔1
pr-improve                                 15   ✅12 ⛔3
suggest-improvements                       15   ✅11 ⛔4
rebase-pr                                  15   ⏸12 ✅3
fix-review                                 15   ⏸10 ✅5
fix-issue                                  13   ⏸11 ✅2
claude                                     14   ⏸14
gsd-planning                               15   ⏸15
issue-catch-up                             15   ⏸15
triage                                     15   ⏸15
docs-drift                                  5   ⛔2 ❌2 ✅1
