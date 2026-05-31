# Claude Metrics Extension

This document records the safer implementation shape for richer Claude/ZAI workflow reporting.

## Status

- **Done:** Structured-first parser and sanitized log fallback.
- **Done:** Shared Claude report renderer.
- **Done:** Last-attempt tracking and improved issue #128 failure context.
- **Done:** `claude-full-output` control with current private-repo default `true`.
- **Done:** Metrics outputs and `claude_metrics_json` propagation through shared actions and workflow report paths.
- **Done:** Parser/report tests, `actionlint`, `npm test`, `npm run lint`, and `git diff --check`.
- **Not done:** Live manual dispatch verification for `pr-improve`, `maintenance`, or `audit-fix`.

## Source Order

Metrics are structured-first:

1. Read the Claude execution file from the last attempt when available.
2. Fall back to `${RUNNER_TEMP}/claude-execution-output.json`.
3. Use job logs only for action errors, GitHub `##[error]` lines, rejected tool text, and a sanitized capped SDK excerpt.

The parser lives in `.github/workflows/scripts/parse-claude-execution.cjs`.

## Metrics

The shared actions expose:

- Runtime: duration, cost, model, turns, turn budget percent, cost per turn, duration per turn.
- Tool stats: total calls, failed calls, rejected calls, denial rate, and tool breakdown JSON.
- File stats: unique `Read` files, unique edit/write files, and git changed files.
- Error context: action error, error messages, last sanitized SDK excerpt, and `claude_metrics_json`.

`claude_metrics_json` is the compact pass-through payload for workflows that do not need to expose every metric as a job output.

## Full Output Safety

`claude-full-output` currently defaults to `true` because this repository is private and detailed SDK logs help diagnose failures.

Before extracting these workflows into a public reusable repository:

- Change the default to `false`.
- Keep core metrics dependent on execution JSON, not raw logs.
- Keep report excerpts sanitized, line-capped, and byte-capped.
- Avoid publishing tool result bodies by default.

## Failure Reporting

`report-failure` accepts explicit Claude metric inputs and also parses failed job logs as a fallback. This is required for matrix jobs such as `pr-improve`, where a downstream report job cannot reliably receive per-matrix child outputs.

The report renderer lives in `.github/workflows/scripts/render-claude-report.cjs`.
