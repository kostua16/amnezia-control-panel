/* eslint-disable @typescript-eslint/no-require-imports */
// Single source of truth for the "no $queryRawUnsafe in src/" guard, shared by
// ci.yml (lint job) and the fix-review validate gate. Exits 1 with ::error
// annotations when the unsafe raw-SQL primitive is used; use Prisma's tagged
// template $queryRaw instead.
const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN = '$queryRawUnsafe';
const SCAN_ROOT = path.resolve(process.env.SCAN_ROOT || 'src');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function scan(root) {
  const matches = [];
  if (!fs.existsSync(root)) {
    return matches;
  }
  for (const file of walk(root)) {
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

module.exports = { FORBIDDEN, scan };
