#!/bin/sh
set -e

echo "[stack-entrypoint] Preparing bundled stack directories…"
/docker/stack/scripts/init-stack-dirs.sh

echo "[stack-entrypoint] Applying database migrations…"
cd /app
npx prisma migrate deploy --schema /app/prisma/schema.prisma --skip-generate

echo "[stack-entrypoint] Initializing AWG config (if needed)…"
/docker/stack/scripts/init-awg.sh

if [ -n "${TS_AUTHKEY:-}" ] && [ -x /usr/local/bin/tailscale ]; then
  SOCKET="${TS_SOCKET:-${TS_STATE_DIR:-/opt/acp-stack/tailscale}/tailscaled.sock}"
  export TS_SOCKET="$SOCKET"
  echo "[stack-entrypoint] Joining Tailscale tailnet (if not already authenticated)…"
  tailscale --socket="$SOCKET" up \
    ${TS_HOSTNAME:+--hostname="$TS_HOSTNAME"} \
    --authkey="$TS_AUTHKEY" \
    ${TS_EXTRA_ARGS:-} || true
fi

echo "[stack-entrypoint] Starting s6 supervision…"
exec /init
