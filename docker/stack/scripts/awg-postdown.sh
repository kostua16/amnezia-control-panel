#!/bin/sh
set -e

IFACE="${AWG_INTERFACE:-awg0}"
EGRESS="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
if [ -z "$EGRESS" ]; then
  exit 0
fi

iptables -t nat -D POSTROUTING -o "$EGRESS" -j MASQUERADE 2>/dev/null || true
iptables -D FORWARD -i "$IFACE" -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -o "$IFACE" -j ACCEPT 2>/dev/null || true
