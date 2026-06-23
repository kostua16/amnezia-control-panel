#!/bin/sh
set -e

DIR=/opt/acp-stack/awg
CONF="$DIR/awg0.conf"
PORT="${ACP_AWG_UDP_PORT:-51821}"
PREFIX="${AWG_CLIENT_IPV4_PREFIX:-10.8.1.}"

mkdir -p "$DIR"

if [ -f "$CONF" ]; then
  exit 0
fi

PRIV="$(awg genkey)"
PUB="$(printf '%s' "$PRIV" | awg pubkey)"

cat >"$CONF" <<EOF
[Interface]
PrivateKey = ${PRIV}
Address = ${PREFIX}1/24
ListenPort = ${PORT}
Jc = 6
Jmin = 8
Jmax = 80
S1 = 40
S2 = 50
H1 = 1020325451
H2 = 3288052141
H3 = 1766607858
H4 = 2528465083
EOF

chmod 600 "$CONF"
echo "[init-awg] created ${CONF}"
