#!/bin/sh
set -e

IFACE="${AWG_INTERFACE:-awg0}"

i=0
while [ ! -e "/sys/class/net/${IFACE}/operstate" ] && [ "$i" -lt 30 ]; do
  sleep 1
  i=$((i + 1))
done

if [ ! -e "/sys/class/net/${IFACE}/operstate" ]; then
  echo "[amneziawg-nat] interface ${IFACE} not ready" >&2
  exit 1
fi

/docker/stack/scripts/awg-postup.sh
