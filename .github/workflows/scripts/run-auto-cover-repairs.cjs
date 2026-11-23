/* eslint-disable @typescript-eslint/no-require-imports */
// Evaluates the PRs whose context fetch-auto-cover-context.cjs wrote to
// --context-dir and acts on every eligible one. Shared by Auto Cover Review
// and Auto Cover Dispatch so the repair dispatch exists once.
//
// Modes:
//   direct      dispatch fix-review right away (the previous behavior).
//   delayed     hand each eligible PR to auto-cover-dispatch.yml, which waits
//               out the quiet period and re-validates before dispatching.
//   revalidate  used by auto-cover-dispatch.yml after the wait: re-evaluate
//               fresh context against the expected head and dispatch
//               fix-review, recording the attempt comment right after the
//               dispatch is accepted.
// --dry-run true never dispatches anything.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateExternalReview } = require('./evaluate-external-review.cjs');
const {
  DEFAULT_MAX_ATTEMPTS,
  evaluateAutoCoverReview,
} = require('./evaluate-auto-cover-review.cjs');

const MODES = ['direct', 'delayed', 'revalidate'];
const AUTO_COVER_MARKER = '<!-- auto-cover-review-summary -->';
const DISPATCH_WORKFLOW = 'auto-cover-dispatch.yml';
const LOOKUP_ATTEMPTS = 10;
const LOOKUP_DELAY_MS = 2000;

function defaultGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readJson(file, fallback) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : fallback;
}

function readPrList(dir) {
  const file = path.join(dir, 'prs-to-evaluate.txt');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function evaluatePr({ dir, prNumber, policy, expectedHeadSha = '' }) {
  const prefix = path.join(dir, `pr-${prNumber}`);
  const pr = readJson(`${prefix}-pr.json`, {});
  const comments = readJson(`${prefix}-comments.json`, []);
  const headSha = fs.readFileSync(`${prefix}-head-sha`, 'utf8').trim();
  const external = evaluateExternalReview({
    pr,
    comments,
    reviewComments: readJson(`${prefix}-review-comments.json`, []),
    reviews: readJson(`${prefix}-reviews.json`, []),
    checkRuns: readJson(`${prefix}-check-runs.json`, []),
    statuses: readJson(`${prefix}-statuses.json`, []),
  });
  fs.writeFileSync(`${prefix}-external-review.json`, JSON.stringify(external));
  const decision = evaluateAutoCoverReview({
    pr,
    policy,
    externalReview: external,
    comments,
    commits: readJson(`${prefix}-commits.json`, []),
    attempts: readJson(`${prefix}-attempts.json`, []),
    fixReviewRuns: readJson(`${prefix}-fix-review-runs.json`, []),
    expectedHeadSha: expectedHeadSha || headSha,
    maxAttempts: Number(
      policy.maxAutoReviewFixAttempts ?? DEFAULT_MAX_ATTEMPTS,
    ),
  });
  fs.writeFileSync(`${prefix}-decision.json`, JSON.stringify(decision));
  return { headSha, decision };
}

function summaryBody({ headSha, dispatcherUrl, fixReviewUrl }) {
  return [
    AUTO_COVER_MARKER,
    '',
    `Auto-cover review dispatched fix-review for \`${headSha}\`.`,
    '',
    `- Dispatcher run: ${dispatcherUrl}`,
    `- Fix-review run: ${fixReviewUrl}`,
    '',
  ].join('\n');
}

function lookupFixReviewRun({ gh, sleep, title, startedAt }) {
  for (let attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt++) {
    try {
      const runs = JSON.parse(
        gh([
          'run',
          'list',
          '--workflow',
          'fix-review.yml',
          '--event',
          'workflow_dispatch',
          '--limit',
          '20',
          '--json',
          'displayTitle,createdAt,url,status,databaseId',
        ]) || '[]',
      );
      const match = runs
        .filter(
          (run) => run.displayTitle === title && run.createdAt >= startedAt,
        )
        .sort((a, b) =>
          String(a.createdAt).localeCompare(String(b.createdAt)),
        )[0];
      if (match?.url) return match.url;
    } catch {
      // The lookup is informational; the dispatch already happened.
    }
    if (attempt < LOOKUP_ATTEMPTS) sleep(LOOKUP_DELAY_MS);
  }
  return '';
}

function commentIdFromUrl(url) {
  const match = String(url ?? '').match(/#issuecomment-(\d+)/);
  return match ? match[1] : '';
}

// Dispatches fix-review on main for one PR head and records the attempt as a
// workflow-owned summary comment (fetch-auto-cover-context counts these).
// recordFirst posts the comment immediately after the dispatch is accepted
// and fills in the run URL afterwards.
function dispatchFixReview({
  prNumber,
  headSha,
  dispatcherUrl,
  repo,
  dir,
  gh = defaultGh,
  sleep = sleepSync,
  now = () => new Date(),
  recordFirst = false,
  onDispatched = () => {},
}) {
  const startedAt = isoSeconds(now());
  const title = `Fix Review PR #${prNumber} @ ${headSha}`;
  gh([
    'workflow',
    'run',
    'fix-review.yml',
    '--ref',
    'main',
    '-f',
    `pr_number=${prNumber}`,
    '-f',
    `head_sha=${headSha}`,
    '-f',
    'automation_review_loop=true',
  ]);
  onDispatched();
  const bodyFile = path.join(dir, `pr-${prNumber}-auto-cover-comment.md`);
  const post = (fixReviewUrl) => {
    fs.writeFileSync(
      bodyFile,
      summaryBody({ headSha, dispatcherUrl, fixReviewUrl }),
    );
    return gh(['issue', 'comment', String(prNumber), '--body-file', bodyFile]);
  };
  if (!recordFirst) {
    const url = lookupFixReviewRun({ gh, sleep, title, startedAt });
    post(url || '_unavailable_');
    return { runUrl: url };
  }
  const commentId = commentIdFromUrl(post('_unavailable_'));
  const url = lookupFixReviewRun({ gh, sleep, title, startedAt });
  if (url && commentId) {
    try {
      gh([
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${commentId}`,
        '-f',
        `body=${summaryBody({ headSha, dispatcherUrl, fixReviewUrl: url })}`,
      ]);
    } catch (error) {
      console.warn(
        `PR #${prNumber}: could not add the fix-review run URL: ${error.message}`,
      );
    }
  }
  return { runUrl: url };
}

function handOff({ prNumber, headSha, gh = defaultGh }) {
  gh([
    'workflow',
    'run',
    DISPATCH_WORKFLOW,
    '--ref',
    'main',
    '-f',
    `pr_number=${prNumber}`,
    '-f',
    `head_sha=${headSha}`,
  ]);
}

function runAutoCoverRepairs({
  dir,
  mode,
  dryRun = false,
  expectedHeadSha = '',
  policy = {},
  repo = '',
  dispatcherUrl = '',
  gh = defaultGh,
  sleep = sleepSync,
  now,
  log = console.log,
  warn = console.warn,
}) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const result = {
    evaluated: 0,
    dispatched: 0,
    handedOff: 0,
    failed: [],
    unrecorded: [],
  };
  for (const prNumber of readPrList(dir)) {
    // Names the step a failure came from, so a scan warning needs no guessing.
    let stage = 'evaluate';
    try {
      const { headSha, decision } = evaluatePr({
        dir,
        prNumber,
        policy,
        expectedHeadSha,
      });
      result.evaluated += 1;
      log(`PR #${prNumber}: ${decision.reason ?? 'eligible'}`);
      if (decision.should_run !== true) continue;
      if (dryRun) {
        log(
          mode === 'delayed'
            ? `Dry-run: would hand off PR #${prNumber} @ ${headSha} to ${DISPATCH_WORKFLOW}`
            : `Dry-run: would dispatch fix-review for PR #${prNumber} @ ${headSha}`,
        );
        continue;
      }
      if (mode === 'delayed') {
        stage = 'handoff';
        handOff({ prNumber, headSha, gh });
        result.handedOff += 1;
        continue;
      }
      stage = 'dispatch';
      dispatchFixReview({
        prNumber,
        headSha,
        dispatcherUrl,
        repo,
        dir,
        gh,
        sleep,
        now,
        recordFirst: mode === 'revalidate',
        // fix-review is already running once the workflow call returns, so a
        // failed attempt comment afterwards still counts as a dispatch.
        onDispatched: () => {
          result.dispatched += 1;
          stage = 'record attempt';
        },
      });
    } catch (error) {
      const message = String(error?.message ?? error)
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
      warn(`::warning::PR #${prNumber} (${stage}): ${message}`);
      // A started fix-review is not a failed repair, but its attempt marker is
      // missing, so the next scan could dispatch the same head again.
      (stage === 'record attempt' ? result.unrecorded : result.failed).push(
        prNumber,
      );
    }
  }
  return result;
}

function summaryLine(mode, result) {
  const list = (numbers) => numbers.map((n) => `#${n}`).join(', ');
  const failed =
    (result.failed.length
      ? ` ${result.failed.length} PR(s) failed: ${list(result.failed)}.`
      : '') +
    (result.unrecorded.length
      ? ` Dispatched but attempt not recorded for: ${list(result.unrecorded)}.`
      : '');
  if (mode === 'delayed') {
    return `Evaluated ${result.evaluated} PR(s); handed off ${result.handedOff} PR(s) to ${DISPATCH_WORKFLOW} (quiet period before fix-review).${failed}`;
  }
  if (failed) {
    return `Evaluated ${result.evaluated} PR(s); completed ${result.dispatched} fix-review dispatch(es).${failed}`;
  }
  return `Evaluated ${result.evaluated} PR(s); dispatched ${result.dispatched} fix-review run(s).`;
}

function getArg(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}

function main(argv = process.argv, env = process.env) {
  const mode = getArg(argv, '--mode');
  const policy = readJson(
    getArg(argv, '--policy-file', '.github/workflows/policy.json'),
    {},
  );
  const repo = env.GITHUB_REPOSITORY ?? '';
  if (
    mode === 'revalidate' &&
    !/^[0-9a-f]{40}$/.test(getArg(argv, '--head-sha'))
  ) {
    // Without the handed-off head the stale-head veto would silently use the
    // current head instead.
    console.error(
      'revalidate needs --head-sha with the full 40-character head SHA.',
    );
    process.exitCode = 2;
    return;
  }
  const result = runAutoCoverRepairs({
    dir: getArg(argv, '--context-dir'),
    mode,
    dryRun: getArg(argv, '--dry-run', 'false') === 'true',
    expectedHeadSha: getArg(argv, '--head-sha'),
    policy,
    repo,
    dispatcherUrl: `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`,
  });
  const line = summaryLine(mode, result);
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
  console.log(line);
  if (result.failed.length > 0 || result.unrecorded.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  AUTO_COVER_MARKER,
  DISPATCH_WORKFLOW,
  MODES,
  commentIdFromUrl,
  dispatchFixReview,
  evaluatePr,
  handOff,
  lookupFixReviewRun,
  runAutoCoverRepairs,
  summaryBody,
  summaryLine,
};
