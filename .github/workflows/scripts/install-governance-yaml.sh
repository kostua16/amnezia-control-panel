#!/usr/bin/env bash
set -euo pipefail

# Extract the standalone parser from the verified release without installing
# packages from the working tree or running package scripts.
archive="$(mktemp)"
trap 'rm -f -- "$archive"' EXIT
curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' \
  --retry 3 --retry-all-errors --retry-max-time 60 \
  --connect-timeout 10 --max-time 20 \
  https://registry.npmjs.org/js-yaml/-/js-yaml-5.5.0.tgz --output "$archive"
# Keep the trust pin in this helper. Tests check it against the lockfile.
expected='paNr4LFIFPjeeSmwNYdrb8FafLLG/Cr2Af3GjbsHJ5CxIjH4r0c2emlmRdAtpPAieP1gRVzk6buBbVP5gBMGAg=='
actual="$(openssl dgst -sha512 -binary "$archive" | openssl base64 -A)"
if [[ "$actual" != "$expected" ]]; then
  echo '::error::Governance YAML parser integrity check failed'
  exit 1
fi
parser="$(mktemp "$RUNNER_TEMP/governance-yaml-XXXXXX.cjs")"
tar -xOzf "$archive" package/dist/js-yaml.cjs.js > "$parser"
if ! node -e 'const yaml = require(process.argv[1]); if (yaml.load("ready: true").ready !== true) process.exit(1)' "$parser"; then
  echo '::error::The verified governance YAML bundle could not parse a test document'
  exit 1
fi
printf 'GOVERNANCE_YAML_PARSER=%s\n' "$parser" >> "$GITHUB_ENV"
