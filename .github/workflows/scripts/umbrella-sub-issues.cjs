/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Spins off umbrella checklist items into dedicated sub-issues and
// reconciles them back (tick checkbox when a sub-issue closes as completed;
// close the umbrella once every item is ticked). Deterministic and
// idempotent — safe to run hourly from issue-catch-up and on-demand from
// fix-issue. All pure logic lives in lib/umbrella-sub-issues-core.cjs.
//
// Usage:
//   node umbrella-sub-issues.cjs (--issue <n> | --all) [--spin-off]
//     [--reconcile] [--cap <n>] [--dry-run]
// Env: GITHUB_REPOSITORY (owner/repo), GH_TOKEN for gh.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const core = require('./lib/umbrella-sub-issues-core.cjs');
const { isTrackingIssue } = require('./lib/tracking-issue.cjs');

const SUB_ISSUE_LABEL = 'umbrella-sub-issue';
const UMBRELLA_TITLE_PREFIX = '[todo-backlog]';

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function gh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function repoSlug() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  return repo;
}

function listOpenUmbrellas() {
  const issues = ghJson([
    'issue',
    'list',
    '--state',
    'open',
    '--search',
    `"${UMBRELLA_TITLE_PREFIX}" in:title`,
    '--json',
    'number,title,body,labels',
    '--limit',
    '50',
  ]);
  return issues.filter(
    (issue) =>
      isTrackingIssue(issue) && core.parseChecklist(issue.body).length > 0,
  );
}

function fetchIssue(number) {
  return ghJson([
    'api',
    `repos/${repoSlug()}/issues/${number}`,
    '--jq',
    '{number: .number, title: .title, body: .body, state: .state, labels: [.labels[].name]}',
  ]);
}

// Known sub-issues of an umbrella: the native sub-issue list plus any issue
// carrying the umbrella-sub-issue label (covers manually spun-off issues
// that were never natively linked).
function listKnownSubIssues(umbrellaNumber) {
  const results = [];
  try {
    const native = ghJson([
      'api',
      `repos/${repoSlug()}/issues/${umbrellaNumber}/sub_issues`,
      '--paginate',
    ]);
    // Tag native-list entries so duplicate reconciliation can prefer a
    // natively-linked keeper (keeps the umbrella progress bar accurate).
    results.push(...native.map((issue) => ({ ...issue, nativeLinked: true })));
  } catch {
    // Sub-issue API unavailable — fall through to the label listing.
  }
  const labeled = ghJson([
    'issue',
    'list',
    '--state',
    'all',
    '--label',
    SUB_ISSUE_LABEL,
    '--search',
    `"#${umbrellaNumber}" in:body`,
    '--json',
    'number,title,body,state,stateReason',
    '--limit',
    '100',
  ]);
  results.push(...labeled);
  return results;
}

function createSubIssue(umbrella, item, workflowName, docContent, dryRun) {
  const title = core.buildSubIssueTitle(item, workflowName);
  const body = core.buildSubIssueBody({
    item,
    umbrellaNumber: umbrella.number,
    docExcerpt: core.extractDocExcerpt(docContent, item.id),
  });
  const labels = core.subIssueLabels(item, SUB_ISSUE_LABEL);
  if (dryRun) {
    console.log(`DRY RUN: would create "${title}" [${labels.join(', ')}]`);
    return { number: null, linked: true };
  }
  const created = ghJson([
    'api',
    `repos/${repoSlug()}/issues`,
    '-f',
    `title=${title}`,
    '-f',
    `body=${body}`,
    ...labels.flatMap((label) => ['-f', `labels[]=${label}`]),
  ]);
  let linked = true;
  try {
    gh([
      'api',
      `repos/${repoSlug()}/issues/${umbrella.number}/sub_issues`,
      '-F',
      `sub_issue_id=${created.id}`,
    ]);
  } catch (error) {
    linked = false;
    // Keep the warn for log readers, but also surface linkFailures in the
    // summary JSON so the spin-off comment and future smoke tests can detect
    // a missing umbrella progress bar instead of relying on this warn.
    console.warn(
      `warning: native sub-issue link failed for #${created.number}: ${error.message}`,
    );
  }
  // Deterministic triage summary: sub-issues are pre-classified by the
  // backlog table, so the AI triage step is skipped for them. issue-catch-up
  // needs a "Triage Result" comment to consider the issue for auto-fix.
  try {
    gh([
      'issue',
      'comment',
      String(created.number),
      '--body',
      core.buildTriageResultComment({ item, umbrellaNumber: umbrella.number }),
    ]);
  } catch (error) {
    console.warn(
      `warning: triage-result comment failed for #${created.number}: ${error.message}`,
    );
  }
  console.log(
    `created #${created.number} "${title}"${linked ? '' : ' (native link failed)'}`,
  );
  return { number: created.number, linked };
}

function reconcileUmbrella(umbrella, subIssues, dryRun) {
  const completedIds = subIssues
    .filter((issue) => core.isCompletedState(issue))
    .map((issue) => core.subIssueTodoId(issue))
    .filter(Boolean);
  const { body, ticked } = core.applyTicks(umbrella.body, completedIds);
  if (ticked.length > 0) {
    if (dryRun) {
      console.log(
        `DRY RUN: would tick ${ticked.join(', ')} on #${umbrella.number}`,
      );
    } else {
      gh([
        'api',
        '-X',
        'PATCH',
        `repos/${repoSlug()}/issues/${umbrella.number}`,
        '-f',
        `body=${body}`,
      ]);
      console.log(`ticked ${ticked.join(', ')} on #${umbrella.number}`);
    }
    umbrella.body = body;
  }
  if (core.allItemsChecked(umbrella.body)) {
    if (dryRun) {
      console.log(`DRY RUN: would close #${umbrella.number} (all items done)`);
    } else {
      gh([
        'issue',
        'close',
        String(umbrella.number),
        '--reason',
        'completed',
        '--comment',
        'All checklist items are complete (every sub-issue closed as completed) — closing this umbrella.',
      ]);
      console.log(`closed umbrella #${umbrella.number} (all items done)`);
    }
    return true;
  }
  return false;
}

function loadDocContent() {
  const docPath = path.join(process.cwd(), 'docs', 'TODOs-2.md');
  try {
    return fs.readFileSync(docPath, 'utf8');
  } catch {
    return '';
  }
}

function processUmbrella(umbrella, options) {
  const items = core.parseChecklist(umbrella.body);
  if (items.length === 0) {
    console.log(`#${umbrella.number}: no parseable checklist — skipping`);
    return {
      umbrella: umbrella.number,
      items: 0,
      created: [],
      ticked: 0,
      linkFailures: 0,
      duplicatesClosed: 0,
    };
  }
  const subIssues = listKnownSubIssues(umbrella.number);
  let closed = false;
  if (options.reconcile) {
    closed = reconcileUmbrella(umbrella, subIssues, options.dryRun);
  }
  const created = [];
  let linkFailures = 0;
  if (options.spinOff && !closed) {
    const plan = core.planSpinOff({
      items: core.parseChecklist(umbrella.body),
      existingSubIssues: subIssues,
      cap: options.cap,
    });
    for (const item of plan.toCreate) {
      const result = createSubIssue(
        umbrella,
        item,
        core.extractWorkflowName(umbrella.title),
        options.docContent,
        options.dryRun,
      );
      if (result.number !== null) {
        created.push({ id: item.id, number: result.number, linked: result.linked });
        if (!result.linked) linkFailures += 1;
      } else {
        created.push({ id: item.id, number: null, linked: true });
      }
    }
    console.log(
      `#${umbrella.number}: open=${plan.openCount} slots=${plan.slots} created=${created.length} deferred=${plan.deferred.length} linkFailures=${linkFailures}`,
    );
  }
  // Post-create re-check: a concurrent run (hourly --all sweep vs this /fix)
  // can observe the same snapshot and spin off the same TODO id. Close the
  // duplicate, keeping the first-created sub-issue. Re-list after spin-off so
  // duplicates created mid-run by the other process are caught this tick.
  let duplicatesClosed = 0;
  if (!options.dryRun) {
    const fresh = listKnownSubIssues(umbrella.number);
    const dupes = core.duplicateSubIssuesToClose(fresh);
    for (const dupe of dupes) {
      gh([
        'issue',
        'close',
        String(dupe.number),
        '--reason',
        'not_planned',
        '--comment',
        `Closing as a duplicate of #${dupe.keepNumber} — both were spun off concurrently for ${dupe.todoId}. The umbrella checkbox and native sub-issue link are tracked by #${dupe.keepNumber}.`,
      ]);
      console.log(
        `closed duplicate #${dupe.number} for ${dupe.todoId} (keep #${dupe.keepNumber})`,
      );
      duplicatesClosed += 1;
    }
  }
  return {
    umbrella: umbrella.number,
    items: items.length,
    created,
    closed,
    linkFailures,
    duplicatesClosed,
  };
}

function runCli() {
  const options = {
    spinOff: hasFlag('--spin-off'),
    reconcile: hasFlag('--reconcile'),
    dryRun: hasFlag('--dry-run'),
    cap: Number(getArg('--cap') || core.DEFAULT_OPEN_CAP),
    docContent: loadDocContent(),
  };
  if (!options.spinOff && !options.reconcile) {
    throw new Error('pass --spin-off and/or --reconcile');
  }
  const issueArg = getArg('--issue');
  const umbrellas = issueArg ? [fetchIssue(issueArg)] : listOpenUmbrellas();
  if (issueArg && !isTrackingIssue(umbrellas[0])) {
    throw new Error(`#${issueArg} is not an umbrella/tracking issue`);
  }
  const summary = umbrellas.map((umbrella) =>
    processUmbrella(umbrella, options),
  );
  console.log(JSON.stringify({ dryRun: options.dryRun, summary }));
}

if (require.main === module) {
  runCli();
}

module.exports = { listOpenUmbrellas, processUmbrella };
