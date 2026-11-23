// Reads the inputs `evaluateExternalReview` needs (issue comments, inline review
// comments, reviews, check runs, commit statuses) with one GraphQL query and
// returns them in the REST shapes that evaluator already consumes. The REST
// bucket is the scarce one, so the PR flow prefers this path; on ANY doubt the
// adapter throws `ReviewInputsUnavailable` and the caller reads REST instead.
//
// Bot logins: REST reports GitHub Apps as `kilo-code-bot[bot]`, GraphQL as
// `kilo-code-bot` with `__typename: 'Bot'`. `lib/kilo.cjs` only trusts the
// `[bot]` form, so the suffix is re-added here for Bot authors only. Widening
// KILO_LOGINS instead would let a human account named `kilo-code-bot` pass as
// a trusted review signal. GitHub forbids brackets in human usernames, so a
// `[bot]` login can only ever come from an App.

const MAX_PAGES_PER_CONNECTION = 10;
const PAGE_SIZE = 100;
const THREAD_COMMENTS_PAGE_SIZE = 50;

class ReviewInputsUnavailable extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReviewInputsUnavailable';
  }
}

const AUTHOR_FIELDS = 'author { __typename login }';
const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

// Connections are guarded by `@include` so a follow-up page only pays for the
// connections that still have pages left.
//
// `statusCheckRollup` reports the LATEST run per check; the REST check-runs
// endpoint lists every run but only its first page (oldest ~30 by id). The
// two can therefore drift in BOTH directions: a superseded cancelled/skipped
// Kilo run that REST sees is invisible here (GraphQL stays `pending` where
// REST said `skipped`), and on a busy head REST's page can miss the latest
// Kilo run entirely (GraphQL says `skipped` where REST stays `pending`).
// Accepted trade-off: both drifts are safe — `skipped` and an aged-out
// `pending` both continue the flow, and `blocked`/`passed` verdicts come from
// comments/reviews, not check runs. REST stays the reference and the fallback.
const REVIEW_INPUTS_QUERY = `
query ReviewInputs(
  $owner: String!, $name: String!, $number: Int!,
  $commentsAfter: String, $reviewsAfter: String,
  $threadsAfter: String, $contextsAfter: String,
  $wantComments: Boolean!, $wantReviews: Boolean!,
  $wantThreads: Boolean!, $wantContexts: Boolean!
) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup @include(if: $wantContexts) {
              contexts(first: ${PAGE_SIZE}, after: $contextsAfter) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                    checkSuite {
                      app { slug name }
                    }
                  }
                  ... on StatusContext {
                    context
                    state
                    description
                    targetUrl
                    createdAt
                    updatedAt
                  }
                }
                ${PAGE_INFO}
              }
            }
          }
        }
      }
      comments(first: ${PAGE_SIZE}, after: $commentsAfter) @include(if: $wantComments) {
        nodes { databaseId ${AUTHOR_FIELDS} body createdAt updatedAt }
        ${PAGE_INFO}
      }
      reviews(first: ${PAGE_SIZE}, after: $reviewsAfter) @include(if: $wantReviews) {
        nodes { databaseId ${AUTHOR_FIELDS} body commit { oid } submittedAt state }
        ${PAGE_INFO}
      }
      reviewThreads(first: ${PAGE_SIZE}, after: $threadsAfter) @include(if: $wantThreads) {
        nodes {
          comments(first: ${THREAD_COMMENTS_PAGE_SIZE}) {
            nodes { databaseId ${AUTHOR_FIELDS} body path commit { oid } originalCommit { oid } createdAt updatedAt }
            ${PAGE_INFO}
          }
        }
        ${PAGE_INFO}
      }
    }
  }
}`;

function unavailable(message, cause) {
  return new ReviewInputsUnavailable(message, cause ? { cause } : undefined);
}

function toUser(author) {
  if (!author || typeof author.login !== 'string') return null;
  const isBot = author.__typename === 'Bot';
  const login =
    isBot && !author.login.endsWith('[bot]')
      ? `${author.login}[bot]`
      : author.login;
  return { login, type: author.__typename ?? null };
}

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

// The sticky-comment update and delete address a comment by its REST id, so a
// comment without a usable `databaseId` must fail the read instead of turning
// into a `DELETE issues/comments/null`.
function toIssueComment(node) {
  if (!Number.isInteger(node.databaseId) || node.databaseId <= 0) {
    throw unavailable('An issue comment has no usable databaseId.');
  }
  return {
    id: node.databaseId,
    user: toUser(node.author),
    body: node.body ?? '',
    created_at: node.createdAt ?? null,
    updated_at: node.updatedAt ?? null,
  };
}

function toReviewComment(node) {
  return {
    id: node.databaseId ?? null,
    user: toUser(node.author),
    body: node.body ?? '',
    path: node.path ?? null,
    commit_id: node.commit?.oid ?? null,
    original_commit_id: node.originalCommit?.oid ?? null,
    created_at: node.createdAt ?? null,
    updated_at: node.updatedAt ?? null,
  };
}

// `updatedAt` is deliberately not copied: the REST review object has no such
// field and the evaluator orders reviews by `submitted_at`. `body` IS part of
// the REST shape and consumers of the written context files read it, so it is
// mapped verbatim.
function toReview(node) {
  return {
    id: node.databaseId ?? null,
    user: toUser(node.author),
    body: node.body ?? '',
    commit_id: node.commit?.oid ?? null,
    submitted_at: node.submittedAt ?? null,
    state: node.state ?? null,
  };
}

function toContext(node) {
  if (node.__typename === 'CheckRun') {
    return {
      kind: 'checkRun',
      value: {
        name: node.name ?? '',
        // REST check runs report status/conclusion in lowercase
        // ('completed', 'success'); GraphQL enums are uppercase.
        status: lower(node.status),
        conclusion: lower(node.conclusion),
        app: node.checkSuite?.app ?? null,
        // Deliberately no `workflow_name`: the REST check-runs response
        // carries none, and `isKiloCheck` matches it — mapping it here would
        // classify checks as Kilo on the GraphQL path only.
      },
    };
  }
  if (node.__typename === 'StatusContext') {
    return {
      kind: 'status',
      value: {
        context: node.context,
        state: lower(node.state),
        description: node.description ?? null,
        target_url: node.targetUrl ?? null,
        created_at: node.createdAt ?? null,
        updated_at: node.updatedAt ?? null,
      },
    };
  }
  return null;
}

function assertConnection(connection, label) {
  if (
    !connection ||
    !Array.isArray(connection.nodes) ||
    !connection.pageInfo ||
    typeof connection.pageInfo.hasNextPage !== 'boolean'
  ) {
    throw unavailable(`GraphQL response is missing the ${label} connection.`);
  }
}

function readPage(response, headSha, want) {
  if (!response || typeof response !== 'object') {
    throw unavailable('GraphQL response was not an object.');
  }
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    const first = response.errors[0]?.message ?? 'unknown error';
    throw unavailable(`GraphQL returned errors: ${first}`);
  }
  const pr = response.data?.repository?.pullRequest;
  if (!pr) throw unavailable('GraphQL response has no pullRequest.');
  const headCommit = pr.commits?.nodes?.[0]?.commit;
  if (typeof pr.headRefOid !== 'string' || !headCommit?.oid) {
    throw unavailable('GraphQL response is missing the head commit oid.');
  }
  if (pr.headRefOid !== headSha || headCommit.oid !== headSha) {
    throw unavailable(
      `PR head moved: expected ${headSha}, GraphQL saw ${pr.headRefOid}.`,
    );
  }

  if (want.comments) assertConnection(pr.comments, 'comments');
  if (want.reviews) assertConnection(pr.reviews, 'reviews');
  if (want.threads) {
    assertConnection(pr.reviewThreads, 'reviewThreads');
    for (const thread of pr.reviewThreads.nodes) {
      assertConnection(thread?.comments, 'reviewThread comments');
      if (thread.comments.pageInfo.hasNextPage) {
        throw unavailable('A review thread has more comments than one page.');
      }
    }
  }
  // `statusCheckRollup` is legitimately null while the head has no checks.
  const rollup = headCommit.statusCheckRollup;
  if (want.contexts && rollup) assertConnection(rollup.contexts, 'contexts');
  return { pr, contexts: want.contexts ? (rollup?.contexts ?? null) : null };
}

function nextCursor(connection, label, pagesRead) {
  if (!connection.pageInfo.hasNextPage) return null;
  if (pagesRead >= MAX_PAGES_PER_CONNECTION) {
    throw unavailable(
      `${label} exceeds ${MAX_PAGES_PER_CONNECTION} pages; falling back.`,
    );
  }
  if (!connection.pageInfo.endCursor) {
    throw unavailable(`${label} has a next page without an end cursor.`);
  }
  return connection.pageInfo.endCursor;
}

/**
 * @param {object} args
 * @param {string} args.repo       `owner/name`
 * @param {number} args.prNumber
 * @param {string} args.headSha    PR head the caller evaluates against
 * @param {(query: string, variables: object) => object} args.runGraphql
 *   synchronous; returns the parsed `{ data, errors }` response or throws
 * @param {{comments?: boolean, reviews?: boolean, threads?: boolean, contexts?: boolean}} [args.want]
 *   connections to read, all by default. A caller that needs only some of them
 *   (e.g. the comment list and the commit statuses at publish time) skips the
 *   rest, which keeps the query cheap; unrequested lists come back empty.
 * @returns {{comments, reviewComments, reviews, checkRuns, statuses, cost}}
 */
function fetchReviewInputsGraphql({
  repo,
  prNumber,
  headSha,
  runGraphql,
  want: requested = {},
}) {
  // `Number(null)`, `Number('')` and negatives must not reach GitHub as PR 0,
  // so require exactly two non-empty segments and a positive integer.
  const repoParts = String(repo ?? '').split('/');
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    throw unavailable('repo must be exactly owner/name.');
  }
  const [owner, name] = repoParts;
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw unavailable('prNumber must be a positive integer.');
  }
  if (!headSha) throw unavailable('headSha is required.');

  const out = {
    comments: [],
    reviewComments: [],
    reviews: [],
    checkRuns: [],
    statuses: [],
  };
  const cursors = { comments: null, reviews: null, threads: null, ctx: null };
  const want = {
    comments: requested.comments !== false,
    reviews: requested.reviews !== false,
    threads: requested.threads !== false,
    contexts: requested.contexts !== false,
  };
  const pages = { comments: 0, reviews: 0, threads: 0, contexts: 0 };
  let cost = 0;

  while (want.comments || want.reviews || want.threads || want.contexts) {
    let response;
    try {
      response = runGraphql(REVIEW_INPUTS_QUERY, {
        owner,
        name,
        number,
        commentsAfter: cursors.comments,
        reviewsAfter: cursors.reviews,
        threadsAfter: cursors.threads,
        contextsAfter: cursors.ctx,
        wantComments: want.comments,
        wantReviews: want.reviews,
        wantThreads: want.threads,
        wantContexts: want.contexts,
      });
    } catch (error) {
      throw unavailable(`GraphQL request failed: ${error.message}`, error);
    }
    const { pr, contexts } = readPage(response, headSha, want);
    cost += Number(response.data?.rateLimit?.cost ?? 0);

    if (want.comments) {
      pages.comments += 1;
      out.comments.push(...pr.comments.nodes.map(toIssueComment));
      cursors.comments = nextCursor(pr.comments, 'comments', pages.comments);
      want.comments = cursors.comments !== null;
    }
    if (want.reviews) {
      pages.reviews += 1;
      out.reviews.push(...pr.reviews.nodes.map(toReview));
      cursors.reviews = nextCursor(pr.reviews, 'reviews', pages.reviews);
      want.reviews = cursors.reviews !== null;
    }
    if (want.threads) {
      pages.threads += 1;
      for (const thread of pr.reviewThreads.nodes) {
        out.reviewComments.push(...thread.comments.nodes.map(toReviewComment));
      }
      cursors.threads = nextCursor(
        pr.reviewThreads,
        'reviewThreads',
        pages.threads,
      );
      want.threads = cursors.threads !== null;
    }
    if (want.contexts) {
      pages.contexts += 1;
      for (const node of contexts?.nodes ?? []) {
        const mapped = toContext(node);
        if (!mapped) {
          // A union member this mapper does not know must not silently shrink
          // the input list (a missing Kilo check can hide a `cancelled`
          // signal) — throw so the caller falls back to REST.
          throw unavailable(
            `Unknown status check context type: ${node?.__typename ?? '(missing __typename)'}.`,
          );
        }
        if (mapped.kind === 'checkRun') out.checkRuns.push(mapped.value);
        else out.statuses.push(mapped.value);
      }
      cursors.ctx = contexts
        ? nextCursor(contexts, 'status check contexts', pages.contexts)
        : null;
      want.contexts = cursors.ctx !== null;
    }
  }

  return { ...out, cost };
}

module.exports = {
  MAX_PAGES_PER_CONNECTION,
  REVIEW_INPUTS_QUERY,
  ReviewInputsUnavailable,
  fetchReviewInputsGraphql,
  lower,
  toContext,
  // Shared with fetch-auto-cover-context.cjs so both GraphQL paths apply the
  // same Bot-login restoration rule.
  toUser,
};
