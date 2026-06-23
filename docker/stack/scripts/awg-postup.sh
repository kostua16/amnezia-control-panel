#!/bin/sh
set -e

IFACE="${AWG_INTERFACE:-awg0}"
EGRESS="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
if [ -z "$EGRESS" ]; then
  echo "[awg-postup] no default route; skipping NAT" >&2
  exit 0
fi

iptables -t nat -A POSTROUTING -o "$EGRESS" -j MASQUERADE
iptables -A FORWARD -i "$IFACE" -j ACCEPT
iptables -A FORWARD -o "$IFACE" -j ACCEPT
