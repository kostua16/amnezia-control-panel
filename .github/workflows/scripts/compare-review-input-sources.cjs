/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only parity check for the Kilo review input sources. For each PR it
// loads the inputs through the REST loaders the PR flow uses and through the
// GraphQL adapter, diffs the normalized inputs, runs evaluateExternalReview on
// both with one frozen `now` and one shared head commit time, and prints a
// table. Exits 1 when any verdict differs.
//
// Usage (needs an authenticated `gh`; GITHUB_REPOSITORY defaults to the
// current repo):
//   node compare-review-input-sources.cjs --pr 1090 --pr 1100
//   node compare-review-input-sources.cjs --open
//   node compare-review-input-sources.cjs --merged 30
//
// It only issues GET requests and GraphQL queries; it never writes to GitHub.

const { execFileSync } = require('node:child_process');
const { evaluateExternalReview } = require('./evaluate-external-review.cjs');
const { isKiloUser } = require('./lib/kilo.cjs');
const { fetchReviewInputsGraphql } = require('./lib/review-inputs-graphql.cjs');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function login(item) {
  return item.user?.login ?? null;
}

// Mirrors the field list of `isKiloCheck` in evaluate-external-review.cjs
// (including the camelCase `workflowName`), so the verdict-relevant filter
// cannot under-match the evaluator this script certifies.
function isKiloCheck(check) {
  return [
    check.name,
    check.app?.slug,
    check.app?.name,
    check.workflowName,
    check.workflow_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes('kilo');
}

// Only the fields evaluateExternalReview reads, in a stable order.
function normalizeInputs(inputs) {
  const byId = (a, b) => (a.id ?? 0) - (b.id ?? 0);
  const time = (item) => ({
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
  });
  return {
    comments: [...inputs.comments].sort(byId).map((c) => ({
      id: c.id,
      login: login(c),
      body: c.body ?? '',
      ...time(c),
    })),
    reviewComments: [...inputs.reviewComments].sort(byId).map((c) => ({
      id: c.id,
      login: login(c),
      body: c.body ?? '',
      commit_id: c.commit_id ?? null,
      original_commit_id: c.original_commit_id ?? null,
      ...time(c),
    })),
    reviews: [...inputs.reviews].sort(byId).map((r) => ({
      id: r.id,
      login: login(r),
      commit_id: r.commit_id ?? null,
      submitted_at: r.submitted_at ?? null,
    })),
    checkRuns: inputs.checkRuns
      .map((c) => ({
        name: c.name,
        conclusion: c.conclusion ?? null,
        app: c.app ? { slug: c.app.slug, name: c.app.name } : null,
        workflow_name: c.workflow_name ?? null,
        workflowName: c.workflowName ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    statuses: inputs.statuses
      .map((s) => ({
        context: s.context,
        state: String(s.state ?? '').toLowerCase(),
        created_at: s.created_at ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

// The subset that can influence the verdict: everything authored by a trusted
// Kilo login, Kilo checks, and the pending Kilo status.
function relevantSubset(normalized, context) {
  const kilo = (item) => isKiloUser({ login: item.login });
  return {
    comments: normalized.comments.filter(kilo),
    reviewComments: normalized.reviewComments.filter(kilo),
    reviews: normalized.reviews.filter(kilo),
    checkRuns: normalized.checkRuns.filter(isKiloCheck),
    statuses: normalized.statuses.filter((s) => s.context === context),
  };
}

function snippet(value) {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

// Lengths alone hide same-length differences (a null field on one side, a
// replaced element in the same slot), so every diff also points at the first
// index where the two normalized lists diverge.
function diffInputs(rest, graphql) {
  const diffs = [];
  for (const key of Object.keys(rest)) {
    const a = rest[key];
    const b = graphql[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const shared = Math.min(a.length, b.length);
    const firstDivergent = Array.from({ length: shared }, (_, i) => i).find(
      (i) => JSON.stringify(a[i]) !== JSON.stringify(b[i]),
    );
    const at = firstDivergent ?? shared;
    diffs.push(
      `${key}: rest ${a.length} vs graphql ${b.length}; first diff [${at}] rest=${snippet(a[at])} graphql=${snippet(b[at])}`,
    );
  }
  return diffs;
}

function listPrs(args) {
  const numbers = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--pr') numbers.push(Number(args[++i]));
    else if (args[i] === '--open') {
      const rows = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          '200',
          '--json',
          'number',
        ]),
      );
      numbers.push(...rows.map((r) => r.number));
    } else if (args[i] === '--merged') {
      const count = Number(args[++i]);
      const rows = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'merged',
          '--limit',
          '200',
          '--json',
          'number,mergedAt',
        ]),
      );
      rows.sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      numbers.push(...rows.slice(0, count).map((r) => r.number));
    }
  }
  return [...new Set(numbers.filter(Number.isInteger))];
}

function main() {
  process.env.GITHUB_REPOSITORY ||= gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  // Required only after GITHUB_REPOSITORY is set: the loaders read it lazily.
  const flow = require('./orchestrate-pr-flow.cjs');
  const { DEFAULT_CONTEXT } = require('./evaluate-external-review.cjs');
  const numbers = listPrs(process.argv.slice(2));
  if (numbers.length === 0) {
    console.error('Pass --pr <n>, --open or --merged <count>.');
    process.exit(2);
  }

  const rows = [];
  let maxCost = 0;
  for (const number of numbers) {
    const meta = JSON.parse(
      gh(['pr', 'view', String(number), '--json', 'headRefOid,state']),
    );
    const pr = { number, headSha: meta.headRefOid };
    pr.headCommittedAt = flow.fetchHeadCommittedAt(pr.headSha);
    const now = new Date().toISOString();
    const restInputs = {
      comments: flow.fetchPrIssueComments(number),
      reviewComments: flow.fetchPrReviewComments(number),
      reviews: flow.fetchPrReviews(number),
      checkRuns: flow.fetchCheckRuns(pr.headSha),
      statuses: flow.fetchCommitStatuses(pr.headSha),
    };
    const row = { number, state: meta.state, sha: pr.headSha.slice(0, 7) };
    try {
      const { cost, ...graphqlInputs } = fetchReviewInputsGraphql({
        repo: process.env.GITHUB_REPOSITORY,
        prNumber: number,
        headSha: pr.headSha,
        runGraphql: flow.runGraphqlQuery,
      });
      maxCost = Math.max(maxCost, cost);
      const a = normalizeInputs(restInputs);
      const b = normalizeInputs(graphqlInputs);
      row.rest = evaluateExternalReview({ pr, ...restInputs, now }).state;
      row.graphql = evaluateExternalReview({ pr, ...graphqlInputs, now }).state;
      row.relevant = diffInputs(
        relevantSubset(a, DEFAULT_CONTEXT),
        relevantSubset(b, DEFAULT_CONTEXT),
      );
      row.full = diffInputs(a, b);
      row.cost = cost;
    } catch (error) {
      row.rest = evaluateExternalReview({ pr, ...restInputs, now }).state;
      row.graphql = `FALLBACK (${error.message})`;
      row.fallback = true;
      row.relevant = [];
      row.full = [];
    }
    // A fallback reads REST for that wake, so its verdict cannot differ; it is
    // reported separately because it means GraphQL gave no coverage there.
    row.match = row.fallback ? null : row.rest === row.graphql;
    rows.push(row);
  }

  console.log(
    '| PR | state | head | REST | GraphQL | verdict | verdict-relevant input diff | full input diff | cost |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| #${r.number} | ${r.state} | ${r.sha} | ${r.rest} | ${r.graphql} | ${r.match === null ? 'fallback' : r.match ? 'identical' : 'DIFFERENT'} | ${r.relevant.join('; ') || 'none'} | ${r.full.join('; ') || 'none'} | ${r.cost ?? '-'} |`,
    );
  }
  const identical = rows.filter((r) => r.match === true).length;
  const fallbacks = rows.filter((r) => r.fallback).length;
  console.log(
    `\nverdict parity: ${identical}/${rows.length} identical, ${fallbacks} GraphQL fallbacks, max rateLimit cost ${maxCost}`,
  );
  process.exit(rows.some((r) => r.match === false) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { diffInputs, normalizeInputs, relevantSubset };
