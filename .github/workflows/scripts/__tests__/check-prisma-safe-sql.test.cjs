/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const scriptPath = path.join(
  repoRoot,
  '.github/workflows/scripts/check-prisma-safe-sql.cjs',
);
const { scan } = require(scriptPath);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-safe-sql-'));
}

function writeFile(root, filePath, content) {
  const fullPath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function makeGitRepo() {
  const root = makeTempDir();
  git(root, ['init']);
  return root;
}

test('tracked unsafe Prisma source fails the guard', () => {
  const root = makeGitRepo();
  writeFile(
    root,
    'src/lib/db.ts',
    'export async function load(prisma) { return prisma.$queryRawUnsafe("select 1"); }\n',
  );
  git(root, ['add', 'src/lib/db.ts']);

  const matches = withCwd(root, () => scan());

  assert.deepEqual(
    matches.map((match) => `${match.file}:${match.line}`),
    ['src/lib/db.ts:1'],
  );
});

test('untracked unsafe Prisma source is ignored in git mode', () => {
  const root = makeGitRepo();
  writeFile(
    root,
    'src/runtime-artifact.ts',
    'export const prompt = "$queryRawUnsafe";\n',
  );

  const matches = withCwd(root, () => scan());

  assert.deepEqual(matches, []);
});

test('tracked non-src unsafe Prisma text is ignored by the default scan root', () => {
  const root = makeGitRepo();
  writeFile(root, 'docs/example.md', 'Do not use $queryRawUnsafe.\n');
  git(root, ['add', 'docs/example.md']);

  const matches = withCwd(root, () => scan());

  assert.deepEqual(matches, []);
});

test('filesystem fallback catches unsafe Prisma source outside a git repo', () => {
  const root = makeTempDir();
  writeFile(root, 'src/lib/db.ts', 'export const query = "$queryRawUnsafe";\n');

  const matches = withCwd(root, () => scan());

  assert.deepEqual(
    matches.map((match) => `${match.file}:${match.line}`),
    ['src/lib/db.ts:1'],
  );
});

test('CLI failure prints a plain path diagnostic', () => {
  const root = makeGitRepo();
  writeFile(
    root,
    'src/lib/db.ts',
    'export async function load(prisma) { return prisma.$queryRawUnsafe("select 1"); }\n',
  );
  git(root, ['add', 'src/lib/db.ts']);

  assert.throws(
    () =>
      execFileSync(process.execPath, [scriptPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error) => {
      assert.match(String(error.stderr), /src\/lib\/db\.ts:1:/);
      assert.match(
        String(error.stdout),
        /::error file=src\/lib\/db\.ts,line=1::/,
      );
      return true;
    },
  );
});
