#!/bin/sh
set -e

IFACE="${AWG_INTERFACE:-awg0}"

if command -v s6-svc >/dev/null 2>&1; then
  s6-svc -r /run/service/amneziawg 2>/dev/null || s6-rc -u change amneziawg
else
  echo "[restart-awg] s6 not available; bundled stack requires s6 supervision" >&2
  exit 1
fi
