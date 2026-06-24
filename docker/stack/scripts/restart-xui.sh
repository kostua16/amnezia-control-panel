#!/bin/sh
set -e
if command -v s6-svc >/dev/null 2>&1; then
  s6-svc -r /run/service/x-ui 2>/dev/null || s6-rc -u change x-ui
else
  pkill -x x-ui 2>/dev/null || true
  sleep 1
  /opt/x-ui/x-ui &
fi
