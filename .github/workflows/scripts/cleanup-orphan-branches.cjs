#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Scheduled sweep of orphan automation branches. A branch is orphan when it
 * matches a policy.json automation prefix, is NOT an open pull request head,
 * and its tip commit is older than the age threshold. These pile up when an
 * automation run pushes a branch with no PR (the delete-on-close job only
 * fires when a PR is closed).
 *
 * Safety: only policy-prefixed branches are candidates (default/feature
 * branches never match), open-PR heads are always skipped, fresh branches get
 * a grace period, and --dry-run previews deletions. Tip dates come from one
 * paginated GraphQL query (the REST branches endpoint omits them).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_PROTECTED = ['main', 'master', 'dev', 'develop'];

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function appendOutput(outputPath, key, value) {
  if (!outputPath) return;
  const delimiter = `EOF-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(
    outputPath,
    `${key}<<${delimiter}\n${String(value ?? '')}\n${delimiter}\n`,
  );
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** REST ref path for deleting a branch. The repos/ prefix is required; without
 * it gh api 404s every branch and the sweep silently deletes nothing. */
function deleteRefPath(repo, branchName) {
  return `repos/${repo}/git/refs/heads/${branchName}`;
}

/** Flatten the policy.json branch-prefix keys into a unique list. */
function collectPolicyPrefixes(policy) {
  const p = policy || {};
  const raw = [
    ...(p.cleanupBranchPrefixes ?? []),
    ...(p.trustedAutomationBranchPrefixes ?? []),
    ...(p.manualOnlyBranchPrefixes ?? []),
    ...(p.trustedPlanning?.branchPrefixes ?? []),
    ...(p.gsdExecution?.branchPrefix ? [p.gsdExecution.branchPrefix] : []),
    ...(p.auditSafe?.safeBranchPrefix ? [p.auditSafe.safeBranchPrefix] : []),
    ...(p.auditSafe?.manualBranchPrefix
      ? [p.auditSafe.manualBranchPrefix]
      : []),
    ...(p.dependabot?.manualOnlyBranchPrefixes ?? []),
    ...(p.planningBranchPrefix ? [p.planningBranchPrefix] : []),
  ];
  return [
    ...new Set(raw.map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  ];
}

/**
 * Pure selector: returns the subset of `branches` that are orphan automation
 * branches safe to delete. `branches` is a list of { name, committedDate }.
 * `openHeads` / `prefixes` / `protectedBranches` are arrays/sets of strings.
 * Unknown commit dates are skipped (never delete a branch whose age is unknown).
 */
function selectOrphanBranches(branches, openHeads, prefixes, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs =
    options.maxAgeMs ?? DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const headSet = new Set(openHeads || []);
  const protectedSet = new Set(options.protectedBranches ?? DEFAULT_PROTECTED);
  const safePrefixes = [...new Set((prefixes || []).filter(Boolean))];

  return (branches || []).filter((branch) => {
    if (!branch || typeof branch !== 'object') return false;
    const name = String(branch.name ?? '');
    if (!name || protectedSet.has(name)) return false;
    if (headSet.has(name)) return false;
    if (!safePrefixes.some((prefix) => name.startsWith(prefix))) return false;

    const committedAt = Date.parse(String(branch.committedDate ?? ''));
    if (Number.isNaN(committedAt)) return false;
    return now - committedAt >= maxAgeMs;
  });
}

/** Paginated GraphQL fetch of every branch name + tip committedDate. */
function fetchBranches(repo) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) {
    throw new Error(`Invalid --repo "${repo}", expected owner/name`);
  }
  const branches = [];
  let cursor = null;
  do {
    const afterClause = cursor
      ? `, after: "${cursor.replace(/[\\"]/g, '')}"`
      : '';
    const query =
      `query{ repository(owner:"${owner}", name:"${name}"){` +
      ` refs(refPrefix:"refs/heads/", first:100${afterClause}){` +
      ` pageInfo{ hasNextPage endCursor }` +
      ` nodes{ name target{ ...on Commit{ committedDate } } } } } }`;
    const data = parseJson(gh(['api', 'graphql', '-f', `query=${query}`]));
    const refs = data?.data?.repository?.refs;
    if (!refs) {
      throw new Error(
        `GraphQL branch fetch failed: ${data?.errors?.[0]?.message || 'empty response'}`,
      );
    }
    for (const node of refs.nodes || []) {
      branches.push({
        name: String(node?.name ?? ''),
        committedDate: node?.target?.committedDate ?? null,
      });
    }
    cursor = refs.pageInfo?.hasNextPage ? refs.pageInfo.endCursor : null;
  } while (cursor);
  return branches;
}

function run() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const policyPath = getArg('--policy-path') || '.github/workflows/policy.json';
  const maxAgeDays = Number(getArg('--max-age-days') || DEFAULT_MAX_AGE_DAYS);
  const dryRunArg = getArg('--dry-run');
  const dryRun = dryRunArg === null ? true : dryRunArg !== 'false';
  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;

  const policy = parseJson(fs.readFileSync(policyPath, 'utf8')) || {};
  const prefixes = collectPolicyPrefixes(policy);
  if (prefixes.length === 0) {
    process.stderr.write(
      '::error::No automation branch prefixes found in policy.json\n',
    );
    process.exit(1);
  }

  const branches = fetchBranches(repo);
  const openHeads = gh([
    'api',
    `repos/${repo}/pulls?state=open`,
    '--paginate',
    '--jq',
    '.[].head.ref',
  ])
    .split('\n')
    .map((ref) => ref.trim())
    .filter(Boolean);

  const orphans = selectOrphanBranches(branches, openHeads, prefixes, {
    maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
  });

  process.stdout.write(
    `Found ${orphans.length} orphan branch(es) of ${branches.length} total ` +
      `(${openHeads.length} open PR head(s) protected, ${prefixes.length} prefixes).\n`,
  );

  if (dryRun) {
    for (const branch of orphans) {
      process.stdout.write(`[dry-run] would delete ${branch.name}\n`);
    }
    appendOutput(outputPath, 'dry_run', 'true');
    appendOutput(outputPath, 'orphan_count', orphans.length);
    return;
  }

  let deleted = 0;
  for (const branch of orphans) {
    try {
      gh(['api', '--method', 'DELETE', deleteRefPath(repo, branch.name)]);
      process.stdout.write(`::notice::Deleted orphan branch ${branch.name}\n`);
      deleted += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stdout.write(
        `::warning::Failed to delete ${branch.name}: ${detail}\n`,
      );
    }
  }
  appendOutput(outputPath, 'dry_run', 'false');
  appendOutput(outputPath, 'deleted_count', deleted);
  appendOutput(outputPath, 'orphan_count', orphans.length);
}

module.exports = { collectPolicyPrefixes, selectOrphanBranches, deleteRefPath };

if (require.main === module) {
  run();
}
