/* eslint-disable @typescript-eslint/no-require-imports */
const { lower, toContext } = require('./review-inputs-graphql.cjs');

const PAGE_SIZE = 32;
const HEAD_OID = /^[a-f0-9]{40}$/i;
const OPEN_PR_FLOW_QUERY = `
query OpenPrFlow($owner: String!, $name: String!, $after: String, $first: Int!) {
  rateLimit { cost remaining limit resetAt }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $after,
                 orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state isDraft headRefOid
        labels(first: 32) { nodes { name } pageInfo { hasNextPage } }
        commits(last: 1) {
          nodes { commit {
            oid
            statusCheckRollup {
              contexts(first: 64) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on StatusContext { context state createdAt }
                  ... on CheckRun {
                    name status conclusion completedAt checkSuite { id }
                  }
                }
              }
            }
            checkSuites(first: 24) {
              pageInfo { hasNextPage }
              nodes {
                id status conclusion
                workflowRun { databaseId runAttempt event workflow { name } }
              }
            }
          } }
        }
      }
    }
  }
}`;

function startsWithPath(path, prefix) {
  return prefix.every((part, index) => path[index] === part);
}

function complete(connection) {
  return (
    connection?.pageInfo?.hasNextPage === false &&
    Array.isArray(connection.nodes) &&
    connection.nodes.every(Boolean)
  );
}

function latestStatuses(contexts) {
  const statuses = contexts
    .map(toContext)
    .filter((context) => context?.kind === 'status')
    .map(({ value }) => value)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const seen = new Set();
  return statuses.filter(({ context }) => {
    if (seen.has(context)) return false;
    seen.add(context);
    return true;
  });
}

// Error paths here are relative to the PR node. Null is unknown for a piece
// of evidence; an empty array is a successfully observed empty connection.
function normalizeFlowObservation(node, errors = []) {
  const affected = (...prefix) =>
    errors.some(
      ({ path }) =>
        !Array.isArray(path) ||
        startsWithPath(path, prefix) ||
        startsWithPath(prefix, path),
    );
  const commit = node.commits?.nodes?.[0]?.commit;
  const headVerified =
    HEAD_OID.test(node.headRefOid) &&
    node.commits?.nodes?.length === 1 &&
    commit?.oid === node.headRefOid &&
    !affected('headRefOid') &&
    !affected('commits', 'nodes', 0, 'commit', 'oid');
  const labels =
    !affected('labels') &&
    complete(node.labels) &&
    node.labels.nodes.every((label) => typeof label.name === 'string')
      ? node.labels.nodes.map((label) => label.name)
      : null;
  const rollup = commit?.statusCheckRollup;
  const contexts = rollup?.contexts;
  const rollupKnown =
    headVerified &&
    !affected('commits', 'nodes', 0, 'commit', 'statusCheckRollup');
  const contextNodes =
    rollupKnown && rollup === null
      ? []
      : rollupKnown &&
          complete(contexts) &&
          contexts.nodes.every(
            (context) =>
              context.__typename === 'CheckRun' ||
              (context.__typename === 'StatusContext' &&
                context.context &&
                context.state &&
                Number.isFinite(Date.parse(context.createdAt))),
          )
        ? contexts.nodes
        : null;

  const suites =
    headVerified && !affected('commits', 'nodes', 0, 'commit', 'checkSuites')
      ? commit.checkSuites
      : null;
  // A bounded head connection can only report observed runs. Dispatch runs
  // can live on the base ref, and retries can reuse a run ID.
  const observedRuns = (suites?.nodes ?? []).flatMap((suite) => {
    const run = suite?.workflowRun;
    return run?.databaseId && run.workflow?.name
      ? [
          {
            suiteId: suite.id,
            databaseId: run.databaseId,
            workflow: run.workflow.name,
            attempt: run.runAttempt,
            event: run.event,
            status: lower(suite.status),
            conclusion: lower(suite.conclusion),
          },
        ]
      : [];
  });

  return {
    number: node.number,
    state: affected('state') ? null : node.state,
    isDraft: affected('isDraft') ? null : node.isDraft,
    headRefOid: node.headRefOid,
    headVerified,
    labels,
    statuses: contextNodes === null ? null : latestStatuses(contextNodes),
    checks:
      contextNodes?.flatMap((context) =>
        context.__typename === 'CheckRun'
          ? [
              {
                name: context.name,
                suiteId: context.checkSuite?.id,
                status: lower(context.status),
                conclusion: lower(context.conclusion),
                completedAt: context.completedAt,
              },
            ]
          : [],
      ) ?? null,
    observedRuns,
    suitesComplete: complete(suites),
  };
}

function fetchOpenPrFlowPage({
  owner,
  repo,
  after = null,
  first = PAGE_SIZE,
  runGraphql,
}) {
  if (!Number.isInteger(first) || first < 1 || first > PAGE_SIZE) {
    throw new Error(`Open PR page size must be between 1 and ${PAGE_SIZE}.`);
  }
  const response = runGraphql(OPEN_PR_FLOW_QUERY, {
    owner,
    name: repo,
    after,
    first,
  });
  const connection = response?.data?.repository?.pullRequests;
  const nodePath = ['repository', 'pullRequests', 'nodes'];
  const errors = response?.errors ?? [];
  const wholePageError = errors.find(
    ({ path }) =>
      !Array.isArray(path) ||
      path.length <= nodePath.length ||
      !startsWithPath(path, nodePath) ||
      !Number.isInteger(path[3]),
  );
  if (wholePageError) {
    throw new Error(
      `GraphQL open PR page failed: ${wholePageError.type ?? ''} ${wholePageError.message}`,
    );
  }
  if (
    !Array.isArray(connection?.nodes) ||
    typeof connection.pageInfo?.hasNextPage !== 'boolean'
  ) {
    throw new Error(
      'GraphQL response is missing the open PR connection or page info.',
    );
  }
  const observations = connection.nodes.map((node, index) => {
    if (!Number.isSafeInteger(node?.number) || node.number <= 0) {
      throw new Error('GraphQL response is missing an open PR identity.');
    }
    const nodeErrors = errors
      .filter(({ path }) => path[3] === index)
      .map((error) => ({ ...error, path: error.path.slice(4) }));
    return normalizeFlowObservation(node, nodeErrors);
  });
  return {
    observations,
    pageInfo: connection.pageInfo,
    rateLimit: response.data.rateLimit,
  };
}

module.exports = { fetchOpenPrFlowPage, normalizeFlowObservation, PAGE_SIZE };
