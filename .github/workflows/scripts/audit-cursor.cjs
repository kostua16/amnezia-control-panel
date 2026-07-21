/* eslint-disable @typescript-eslint/no-require-imports */
// Consumer for .planning/audit-cursor.json (AFX-E01 per-run audit-area rotation).
// The audit-fix workflow calls this twice per run:
//   1. `select`  -> emits the focus area for this run (injected into the agent
//      prompt so the agent audits only that area and respects its `exclude` list).
//   2. `advance` -> rotates current_index (mod length) and stamps last_audited_run,
//      writing the file back so the next run picks up the new position. The
//      workflow commits this change with the audit PR.
const fs = require('fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function readCursor(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Pure: validate + clamp current_index against the focus_areas array.
function normalizeIndex(raw) {
  const total = Array.isArray(raw.focus_areas) ? raw.focus_areas.length : 0;
  if (total === 0) {
    throw new Error('cursor has no focus_areas');
  }
  let idx = Number(raw.current_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= total) idx = 0;
  return { idx, total };
}

// Pure: select the focus area for this run + the next rotation index.
function selectFocus(raw) {
  const { idx, total } = normalizeIndex(raw);
  const area = raw.focus_areas[idx];
  const exclude = Array.isArray(area.exclude) ? area.exclude : [];
  return {
    name: String(area.name ?? ''),
    path: String(area.path ?? ''),
    exclude,
    description: String(area.description ?? ''),
    // Single-line scoping clause for the agent prompt, e.g.
    // "src/app (excluding src/app/api)". Honoring `exclude` here is what
    // prevents the api-routes area from being double-audited under app-pages.
    focus_clause: exclude.length
      ? `${area.path} (excluding ${exclude.join(', ')})`
      : String(area.path),
    current_index: idx,
    next_index: (idx + 1) % total,
    total,
  };
}

// Pure: produce the next cursor state (rotated index + run stamp).
function advanceCursor(raw, runId) {
  const { idx, total } = normalizeIndex(raw);
  const next = {
    ...raw,
    current_index: (idx + 1) % total,
    last_audited_run: runId ?? null,
  };
  return { next, current_index: next.current_index, total };
}

function runSelect(filePath) {
  const out = selectFocus(readCursor(filePath));
  process.stdout.write(JSON.stringify(out));
}

function runAdvance(filePath, runId) {
  const { next, current_index, total } = advanceCursor(
    readCursor(filePath),
    runId,
  );
  // Match the committed file's formatting (2-space indent, trailing newline).
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(
    JSON.stringify({ ok: true, current_index, total, last_audited_run: next.last_audited_run }),
  );
}

function runCli() {
  const mode = process.argv[2];
  const cursor = getArg('--cursor');
  if (!cursor) {
    process.stderr.write('audit-cursor: missing --cursor <path>\n');
    process.exit(2);
  }
  if (mode === 'select') {
    runSelect(cursor);
  } else if (mode === 'advance') {
    runAdvance(cursor, getArg('--run-id'));
  } else {
    process.stderr.write(`audit-cursor: unknown mode "${mode}" (select|advance)\n`);
    process.exit(2);
  }
}

module.exports = {
  getArg,
  readCursor,
  normalizeIndex,
  selectFocus,
  advanceCursor,
};

if (require.main === module) {
  runCli();
}
