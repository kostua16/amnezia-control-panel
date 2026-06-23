#!/bin/sh
set -e
IFACE="${AWG_INTERFACE:-awg0}"
if command -v s6-svc >/dev/null 2>&1; then
  s6-svc -r /run/service/amneziawg 2>/dev/null || s6-rc -u change amneziawg
else
  awg-quick down "$IFACE" 2>/dev/null || true
  awg-quick up "$IFACE" 2>/dev/null || true
fi
