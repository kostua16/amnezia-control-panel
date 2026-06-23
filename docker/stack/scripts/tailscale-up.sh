#!/bin/sh
set -e

if [ -z "${TS_AUTHKEY:-}" ] || [ ! -x /usr/local/bin/tailscale ]; then
  exit 0
fi

STATE_DIR="${TS_STATE_DIR:-/opt/acp-stack/tailscale}"
SOCKET="${TS_SOCKET:-${STATE_DIR}/tailscaled.sock}"
export TS_SOCKET="$SOCKET"

i=0
while [ ! -S "$SOCKET" ] && [ "$i" -lt 30 ]; do
  sleep 1
  i=$((i + 1))
done

if [ ! -S "$SOCKET" ]; then
  echo "[tailscale-up] socket not ready: $SOCKET" >&2
  exit 1
fi

if tailscale --socket="$SOCKET" status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
  echo "[tailscale-up] already authenticated"
  exit 0
fi

echo "[tailscale-up] joining tailnet…"
tailscale --socket="$SOCKET" up \
  ${TS_HOSTNAME:+--hostname="$TS_HOSTNAME"} \
  --authkey="$TS_AUTHKEY" \
  ${TS_EXTRA_ARGS:-}
