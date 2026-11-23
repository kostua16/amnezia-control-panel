// Single source of truth for what counts as a "trusted Kilo review" signal:
// the hidden HTML marker string and the Kilo bot-login allow-list. Consumed by
// evaluate-external-review.cjs (coverage gate), collect-review-feedback.cjs
// (noise filtering), and evaluate-trigger-policy.cjs (trigger policy). Keeping
// these here means the marker and login list can drift in only one place.

const KILO_MARKER = '<!-- kilo-review -->';
const KILO_LOGINS = ['kilo-code-bot[bot]'];

function userLogin(user = {}) {
  return String(user.login ?? user.author?.login ?? '');
}

function isKiloUser(user = {}) {
  return KILO_LOGINS.includes(userLogin(user));
}

function isKiloSummary(comment = {}) {
  return (
    isKiloUser(comment.user ?? comment.author ?? {}) &&
    String(comment.body ?? '').includes(KILO_MARKER)
  );
}

// Kilo keeps earlier review snapshots below this marker in its sticky comment.
const KILO_HISTORY_MARKER = '<!-- kilo-review-history -->';

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n');
}

// Kilo updates its sticky comment twice per review: the first edit rewrites
// the current review (the text before the history marker), the second only
// appends the previous review to the history section. True only for that
// second kind of edit: an `edited` Kilo sticky comment whose previous and new
// bodies both carry the history marker and share a byte-identical current
// review. Anything else (created, missing previous body, no marker) is
// treated as a meaningful change.
function isKiloHistoryOnlyEdit(event = {}) {
  if (event?.action !== 'edited') return false;
  const comment = event.comment ?? {};
  if (!isKiloSummary(comment)) return false;
  const before = event.changes?.body?.from;
  if (typeof before !== 'string') return false;
  const previous = normalizeNewlines(before);
  const current = normalizeNewlines(comment.body ?? '');
  if (
    !previous.includes(KILO_HISTORY_MARKER) ||
    !current.includes(KILO_HISTORY_MARKER)
  ) {
    return false;
  }
  return (
    previous.split(KILO_HISTORY_MARKER)[0] ===
    current.split(KILO_HISTORY_MARKER)[0]
  );
}

module.exports = {
  KILO_MARKER,
  KILO_HISTORY_MARKER,
  KILO_LOGINS,
  isKiloUser,
  isKiloSummary,
  isKiloHistoryOnlyEdit,
};
