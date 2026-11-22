/* eslint-disable @typescript-eslint/no-require-imports */
// Decides whether an `issue_comment` event still has to wake the PR
// Orchestrator / Auto Cover Review. Only one case is filtered: a Kilo sticky
// comment edit that leaves the current review untouched and only grows the
// review history (see isKiloHistoryOnlyEdit). Every other event, an unreadable
// event file, or KILO_EDIT_FILTER=off keeps today's behavior (should_run=true).
//
// Output (stdout, GITHUB_OUTPUT format):
//   should_run=true|false
//   history_only=true|false
const fs = require('node:fs');
const { isKiloHistoryOnlyEdit } = require('./lib/kilo.cjs');

function classifyKiloCommentEdit({ event, filter = '' } = {}) {
  if (
    String(filter ?? '')
      .trim()
      .toLowerCase() === 'off'
  ) {
    return {
      should_run: true,
      history_only: false,
      reason: 'Kilo edit filter is off.',
    };
  }
  if (isKiloHistoryOnlyEdit(event)) {
    return {
      should_run: false,
      history_only: true,
      reason: 'Kilo edit changed only the review history.',
    };
  }
  return {
    should_run: true,
    history_only: false,
    reason: 'Event can change the review verdict.',
  };
}

function getArg(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}

function run(argv = process.argv, env = process.env) {
  let result;
  try {
    const eventPath = getArg(argv, '--event-path', env.GITHUB_EVENT_PATH);
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    result = classifyKiloCommentEdit({
      event,
      filter: getArg(argv, '--filter', env.KILO_EDIT_FILTER ?? ''),
    });
  } catch (error) {
    // Never drop a wake because the classifier itself failed.
    result = {
      should_run: true,
      history_only: false,
      reason: `Classifier error, keeping the wake: ${error.message}`,
    };
  }
  console.error(`classify-kilo-comment-edit: ${result.reason}`);
  return `should_run=${result.should_run}\nhistory_only=${result.history_only}\n`;
}

if (require.main === module) {
  process.stdout.write(run());
}

module.exports = { classifyKiloCommentEdit, run };
