/* eslint-disable @typescript-eslint/no-require-imports */
// Shared retry policy for gh CLI calls across workflow scripts.
// Extracted from sticky-comment.cjs so orchestrate-pr-flow.cjs, watch-pr-flow.cjs,
// and future scripts share one transient-error detection and retry implementation.

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// Transient failures worth retrying on idempotent (read) gh calls: gh's literal
// "HTTP 5xx" response plus the network-level errors Go's net/http emits on a CI
// `gh api` call (TCP reset, dial/TLS timeout, context deadline, truncated body).
// Patterns use the `i` flag so they match gh's stderr verbatim regardless of how
// `gh` capitalizes the status text (e.g. "HTTP 504") — a case-sensitive match
// here would silently disable 5xx retry, the exact transient this PR targets.
const TRANSIENT_PATTERNS = [
  /HTTP 5\d{2}/i,
  /connection reset/i,
  /connection refused/i,
  /dial tcp/i,
  /i\/o timeout/i,
  /tls handshake timeout/i,
  /context deadline exceeded/i,
  /unexpected eof/i,
];

function isTransient(stderr) {
  return TRANSIENT_PATTERNS.some((re) => re.test(String(stderr)));
}

module.exports = {
  MAX_RETRIES,
  RETRY_BASE_MS,
  TRANSIENT_PATTERNS,
  isTransient,
};
