#!/bin/sh
set -e

mkdir -p \
  /opt/acp-stack/x-ui \
  /opt/acp-stack/awg \
  /opt/acp-stack/tailscale \
  /app/data/geoip \
  /app/data/prisma \
  /app/logs

chown -R appuser:appgroup /opt/acp-stack /app/data /app/logs 2>/dev/null || true
