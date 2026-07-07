/* eslint-disable @typescript-eslint/no-require-imports */
// Single source of truth for the "no $queryRawUnsafe in src/" guard, shared by
// ci.yml (lint job) and the fix-review validate gate. Exits 1 with ::error
// annotations when the unsafe raw-SQL primitive is used; use Prisma's tagged
// template $queryRaw instead.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FORBIDDEN = '$queryRawUnsafe';
const DEFAULT_SCAN_ROOT = 'src';
const SCAN_ROOT = process.env.SCAN_ROOT || DEFAULT_SCAN_ROOT;

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function normalizeScanRoot(root) {
  const relative = path.isAbsolute(root)
    ? path.relative(process.cwd(), root)
    : root;
  const normalized = toPosixPath(relative).replace(/\/+$/, '');
  return normalized || '.';
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated code (e.g. the Prisma client output under src/generated).
      // That output legitimately defines $queryRawUnsafe as part of its public
      // API; this guard targets hand-written application code, not vendored
      // generators, so walking into it produces false positives.
      if (entry.name === 'generated') continue;
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function listTrackedFiles(root) {
  const scanRoot = normalizeScanRoot(root);
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--', scanRoot === '.' ? '*' : `${scanRoot}/**`],
      {
        cwd: process.cwd(),
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return output
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((file) => path.resolve(process.cwd(), file));
  } catch {
    return null;
  }
}

function listFiles(root) {
  const tracked = listTrackedFiles(root);
  if (tracked) {
    return tracked;
  }

  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  return walk(absoluteRoot);
}

function scan(root = SCAN_ROOT) {
  const matches = [];
  for (const file of listFiles(root)) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // skip binary / unreadable files (mirrors grep -R best-effort)
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(FORBIDDEN)) {
        matches.push({
          file: path.relative(process.cwd(), file),
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
  return matches;
}

function main() {
  const matches = scan(SCAN_ROOT);
  for (const m of matches) {
    console.error(`${m.file}:${m.line}: Use Prisma tagged template $queryRaw.`);
    console.log(
      `::error file=${m.file},line=${m.line}::Use Prisma tagged template $queryRaw instead of $queryRawUnsafe.`,
    );
  }
  if (matches.length > 0) {
    console.error(
      `Found ${matches.length} unsafe $queryRawUnsafe usage(s) in ${SCAN_ROOT}.`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { FORBIDDEN, listFiles, listTrackedFiles, scan };
