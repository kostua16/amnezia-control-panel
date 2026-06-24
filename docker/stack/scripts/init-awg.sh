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

rand_u32() {
  od -An -N4 -tu4 /dev/urandom | tr -d ' '
}

Jc=$(( $(rand_u32) % 10 + 1 ))
Jmin=$(( $(rand_u32) % 50 + 1 ))
Jmax=$(( Jmin + $(rand_u32) % 50 + 1 ))
S1=$(( $(rand_u32) % 150 + 1 ))
S2=$(( $(rand_u32) % 150 + 1 ))
H1="$(rand_u32)"
H2="$(rand_u32)"
H3="$(rand_u32)"
H4="$(rand_u32)"

cat >"$CONF" <<EOF
[Interface]
PrivateKey = ${PRIV}
Address = ${PREFIX}1/24
ListenPort = ${PORT}
Jc = ${Jc}
Jmin = ${Jmin}
Jmax = ${Jmax}
S1 = ${S1}
S2 = ${S2}
H1 = ${H1}
H2 = ${H2}
H3 = ${H3}
H4 = ${H4}
EOF

chmod 600 "$CONF"
echo "[init-awg] created ${CONF}"
