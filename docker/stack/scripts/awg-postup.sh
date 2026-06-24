#!/bin/sh
set -e

IFACE="${AWG_INTERFACE:-awg0}"
EGRESS="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
if [ -z "$EGRESS" ]; then
  echo "[awg-postup] no default route; skipping NAT" >&2
  exit 0
fi

iptables -t nat -C POSTROUTING -o "$EGRESS" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "$EGRESS" -j MASQUERADE
iptables -C FORWARD -i "$IFACE" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "$IFACE" -j ACCEPT
iptables -C FORWARD -o "$IFACE" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -o "$IFACE" -j ACCEPT
