const fs = require('node:fs');
const path = require('node:path');
const { load, JSON_SCHEMA } = require('js-yaml');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function parseUpdated(value) {
  if (typeof value !== 'string') return NaN;
  const iso =
    /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  const match = value.match(iso);
  if (!match) return NaN;

  const day = Date.parse(match[1]);
  if (
    !Number.isFinite(day) ||
    new Date(day).toISOString().slice(0, 10) !== match[1]
  )
    return NaN;

  return Date.parse(value);
}

function pruneStaleDebugDocs(directory, now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const file = path.join(directory, entry.name);
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (error) {
      console.warn(`Skipping ${file}: ${error.code ?? error.message}`);
      continue;
    }
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)^---[ \t]*\r?$/m);
    if (!frontmatter || frontmatter.index !== 0) continue;

    let metadata;
    try {
      metadata = load(frontmatter[1], { schema: JSON_SCHEMA });
    } catch {
      continue;
    }

    if (
      metadata?.status !== 'resolved' ||
      !(parseUpdated(metadata.updated) < now - RETENTION_MS)
    )
      continue;

    try {
      fs.unlinkSync(file);
      console.log(`Pruned ${file}`);
    } catch (error) {
      console.warn(`Could not prune ${file}: ${error.code ?? error.message}`);
    }
  }
}

if (require.main === module) pruneStaleDebugDocs('.planning/debug');

module.exports = { pruneStaleDebugDocs };
