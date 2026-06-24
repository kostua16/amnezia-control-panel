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

module.exports = {
  KILO_MARKER,
  KILO_LOGINS,
  isKiloUser,
  isKiloSummary,
};
