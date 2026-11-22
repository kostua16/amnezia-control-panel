const fs = require('node:fs');
const path = require('node:path');
const { load, JSON_SCHEMA } = require('js-yaml');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
    const frontmatter = fs
      .readFileSync(file, 'utf8')
      .match(/^---\r?\n([\s\S]*?)^---[ \t]*\r?$/m);
    if (!frontmatter || frontmatter.index !== 0) continue;

    let metadata;
    try {
      metadata = load(frontmatter[1], { schema: JSON_SCHEMA });
    } catch {
      continue;
    }

    if (metadata?.status !== 'resolved' || typeof metadata.updated !== 'string')
      continue;
    if (Date.parse(metadata.updated) < now - RETENTION_MS) {
      fs.unlinkSync(file);
      console.log(`Pruned ${file}`);
    }
  }
}

if (require.main === module) pruneStaleDebugDocs('.planning/debug');

module.exports = { pruneStaleDebugDocs };
