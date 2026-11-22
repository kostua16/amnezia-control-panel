/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only parity check for the PR flow's REST-to-GraphQL reads. For each PR
// it loads the Kilo review inputs through the REST loaders the PR flow uses and
// through the GraphQL adapter, diffs the normalized inputs, runs
// evaluateExternalReview on both with one frozen `now` and one shared head
// commit time, and prints a table. It then compares the three other reads the
// PR flow moved to GraphQL: the head commit date, the sticky-comment lookup
// and the commit statuses (as the post/skip decisions `shouldPublishStatus`
// makes from them). Exits 1 when any verdict or any of those differs.
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
const { findExistingComment } = require('./lib/sticky-comment.cjs');

// A fixed link standing in for "the run that is publishing now"; only used to
// exercise the same branches `shouldPublishStatus` takes in production.
const PARITY_RUN_URL = 'https://github.com/owner/repo/actions/runs/1';

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

// The fields `shouldPublishStatus` and `indexStatusesByContext` read, in a
// stable order.
function normalizeStatusList(statuses) {
  return [...(statuses ?? [])]
    .map((s) => ({
      context: s.context,
      state: String(s.state ?? '').toLowerCase(),
      description: s.description ?? null,
      target_url: s.target_url ?? null,
      created_at: s.created_at ?? null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

// For each context the post/skip answer `shouldPublishStatus` gives for the
// four kinds of candidate a wake can publish: the same success again, a
// success whose description changed, a pending status, and a success that links
// to the publishing run. Identical answers on both sources mean the skip logic
// cannot tell the sources apart.
function statusDecisions(statuses, flow) {
  const index = flow.indexStatusesByContext(statuses);
  const decisions = {};
  for (const [context, previous] of [...index].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const description = previous.description ?? '';
    const targetUrl = previous.target_url ?? '';
    const candidates = {
      same: { context, state: 'success', description, targetUrl },
      changedDescription: {
        context,
        state: 'success',
        description: `${description} (changed)`,
        targetUrl,
      },
      pending: { context, state: 'pending', description, targetUrl },
      currentRunLink: {
        context,
        state: 'success',
        description,
        targetUrl: PARITY_RUN_URL,
      },
    };
    decisions[context] = Object.fromEntries(
      Object.entries(candidates).map(([name, status]) => [
        name,
        flow.shouldPublishStatus(index, status, PARITY_RUN_URL),
      ]),
    );
  }
  return decisions;
}

function verdict(a, b) {
  return JSON.stringify(a) === JSON.stringify(b) ? 'identical' : 'DIFFERENT';
}

/**
 * Compares the head commit date, the sticky-comment lookup and the statuses
 * between the REST reads and what the PR flow now reads through GraphQL.
 *
 * @param {object} args
 * @param {object} args.flow           the orchestrate-pr-flow module
 * @param {string} args.headSha
 * @param {string} args.restHeadCommittedAt
 * @param {Array|undefined} args.prCommits  `commits` of `gh pr view --json commits`
 * @param {Array} args.restComments
 * @param {Array} args.restStatuses
 * @param {{comments: Array, statuses: Array}|null} args.snapshot
 *   the publish-time GraphQL read, or null when it fell back to REST
 */
function compareReusePoints({
  flow,
  headSha,
  restHeadCommittedAt,
  prCommits,
  restComments,
  restStatuses,
  snapshot,
}) {
  const graphqlDate = flow.headCommittedAtFromCommits(prCommits, headSha);
  const head =
    graphqlDate === ''
      ? {
          result: 'fallback',
          detail: `REST ${restHeadCommittedAt || '(none)'}, PR read has no usable date`,
        }
      : {
          result: verdict(restHeadCommittedAt, graphqlDate),
          detail: `REST ${restHeadCommittedAt} vs PR read ${graphqlDate}`,
        };

  if (!snapshot) {
    return {
      head,
      sticky: { result: 'fallback', detail: 'publish-time read unavailable' },
      statuses: { result: 'fallback', detail: 'publish-time read unavailable' },
    };
  }

  const restId =
    findExistingComment(restComments, flow.COMMENT_MARKER)?.id ?? null;
  const graphqlId =
    findExistingComment(snapshot.comments, flow.COMMENT_MARKER)?.id ?? null;
  const listDiff = diffInputs(
    normalizeInputs({
      comments: restComments,
      reviewComments: [],
      reviews: [],
      checkRuns: [],
      statuses: [],
    }),
    normalizeInputs({
      comments: snapshot.comments,
      reviewComments: [],
      reviews: [],
      checkRuns: [],
      statuses: [],
    }),
  );
  const sticky = {
    result:
      restId === graphqlId && listDiff.length === 0 ? 'identical' : 'DIFFERENT',
    detail: `REST id ${restId ?? 'none'} vs GraphQL id ${graphqlId ?? 'none'}${listDiff.length ? `; ${listDiff.join('; ')}` : ''}`,
  };

  const restList = normalizeStatusList(restStatuses);
  const graphqlList = normalizeStatusList(snapshot.statuses);
  const restDecisions = statusDecisions(restStatuses, flow);
  const graphqlDecisions = statusDecisions(snapshot.statuses, flow);
  const statusesMatch =
    verdict(restList, graphqlList) === 'identical' &&
    verdict(restDecisions, graphqlDecisions) === 'identical';
  const statuses = {
    result: statusesMatch ? 'identical' : 'DIFFERENT',
    detail: statusesMatch
      ? `${restList.length} status(es), post/skip answers equal for ${Object.keys(restDecisions).length} context(s)`
      : `REST ${JSON.stringify(restList)} ${JSON.stringify(restDecisions)} vs GraphQL ${JSON.stringify(graphqlList)} ${JSON.stringify(graphqlDecisions)}`,
  };
  return { head, sticky, statuses };
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
    // One call, as in the orchestrator: `commits` supplies the head commit date.
    const meta = JSON.parse(
      gh(['pr', 'view', String(number), '--json', 'headRefOid,state,commits']),
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
    // The publish-time read, exactly as the orchestrator makes it.
    let snapshot = null;
    try {
      snapshot = flow.fetchPublishSnapshotGraphql(pr, { wantStatuses: true });
    } catch {
      snapshot = null;
    }
    row.reuse = compareReusePoints({
      flow,
      headSha: pr.headSha,
      restHeadCommittedAt: flow.fetchHeadCommittedAt(pr.headSha, {
        strict: true,
      }),
      prCommits: meta.commits,
      restComments: restInputs.comments,
      restStatuses: restInputs.statuses,
      snapshot,
    });
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

  console.log(
    '\n| PR | head commit date | sticky comment id (REST vs GraphQL) | statuses and post/skip decisions |',
  );
  console.log('|---|---|---|---|');
  for (const r of rows) {
    const { head, sticky, statuses } = r.reuse;
    console.log(
      `| #${r.number} | ${head.result}: ${head.detail} | ${sticky.result}: ${sticky.detail} | ${statuses.result}: ${statuses.detail} |`,
    );
  }
  const points = ['head', 'sticky', 'statuses'];
  for (const point of points) {
    const results = rows.map((r) => r.reuse[point].result);
    console.log(
      `${point} parity: ${results.filter((x) => x === 'identical').length}/${rows.length} identical, ${results.filter((x) => x === 'fallback').length} fallbacks, ${results.filter((x) => x === 'DIFFERENT').length} different`,
    );
  }
  const reuseDiffers = rows.some((r) =>
    points.some((point) => r.reuse[point].result === 'DIFFERENT'),
  );
  process.exit(rows.some((r) => r.match === false) || reuseDiffers ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  compareReusePoints,
  diffInputs,
  normalizeInputs,
  relevantSubset,
  statusDecisions,
};
