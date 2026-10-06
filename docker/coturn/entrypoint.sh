#!/bin/sh
set -eu
CALL_TURN_RELAY_RANGE=${CALL_TURN_RELAY_RANGE:-20800-20999}
if ! printf '%s\n' "$CALL_TURN_RELAY_RANGE" | awk -F- '
  /^[1-9][0-9]*-[1-9][0-9]*$/ && NF == 2 && $1 >= 1024 && $2 <= 65535 && $1 < $2 { valid=1 }
  END { exit !valid }'; then
  echo 'Invalid CALL_TURN_RELAY_RANGE; use START-END within 1024-65535' >&2; exit 1
fi
export CALL_TURN_RELAY_RANGE
case "${CALL_TURN_SECRET:-}" in *[!a-zA-Z0-9_-]*|'') echo 'Set CALL_TURN_SECRET (32+ safe characters)' >&2; exit 1;; esac
[ "${#CALL_TURN_SECRET}" -ge 32 ] || exit 1
case "${CALL_TURN_PUBLIC_IP:-}" in *[!0-9.]*|'') echo 'Set CALL_TURN_PUBLIC_IP to the public IPv4 address' >&2; exit 1;; esac
CALL_TURN_PORT=${CALL_TURN_PORT:-3478}
case $CALL_TURN_PORT in ''|*[!0-9]*|0*) echo 'Invalid CALL_TURN_PORT' >&2; exit 1 ;; esac
[ "${#CALL_TURN_PORT}" -le 5 ] && [ "$CALL_TURN_PORT" -ge 1024 ] && [ "$CALL_TURN_PORT" -le 65535 ] || exit 1
CALL_TURN_REALM=${CALL_TURN_REALM:-opensend-calling}
case $CALL_TURN_REALM in ''|*[!a-zA-Z0-9._-]*) echo 'Invalid CALL_TURN_REALM' >&2; exit 1 ;; esac
# Generate a private config so the shared secret is absent from process arguments.
umask 077
cat > /tmp/turnserver.conf <<CONFIG
listening-port=${CALL_TURN_PORT}
min-port=${CALL_TURN_RELAY_RANGE%-*}
max-port=${CALL_TURN_RELAY_RANGE#*-}
external-ip=${CALL_TURN_PUBLIC_IP}
realm=${CALL_TURN_REALM}
use-auth-secret
static-auth-secret=${CALL_TURN_SECRET}
fingerprint
no-cli
no-dtls
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
no-tcp-relay
no-software-attribute
log-file=stdout
pidfile=/tmp/turnserver.pid
CONFIG
if [ -n "${CALL_TURN_CERT_FILE:-}${CALL_TURN_KEY_FILE:-}" ]; then
  [ -r "${CALL_TURN_CERT_FILE:-}" ] && [ -r "${CALL_TURN_KEY_FILE:-}" ] || {
    echo 'Set readable CALL_TURN_CERT_FILE and CALL_TURN_KEY_FILE' >&2; exit 1;
  }
  case "$CALL_TURN_CERT_FILE$CALL_TURN_KEY_FILE" in *[[:space:]]*) echo 'Invalid TURN certificate path' >&2; exit 1 ;; esac
  CALL_TURN_TLS_PORT=${CALL_TURN_TLS_PORT:-5349}
  case $CALL_TURN_TLS_PORT in ''|*[!0-9]*|0*) echo 'Invalid CALL_TURN_TLS_PORT' >&2; exit 1 ;; esac
  [ "${#CALL_TURN_TLS_PORT}" -le 5 ] && [ "$CALL_TURN_TLS_PORT" -ge 1024 ] && [ "$CALL_TURN_TLS_PORT" -le 65535 ] || exit 1
  [ "$CALL_TURN_TLS_PORT" != "$CALL_TURN_PORT" ] || { echo 'TURN listener ports must differ' >&2; exit 1; }
  cat >> /tmp/turnserver.conf <<TLS
tls-listening-port=${CALL_TURN_TLS_PORT}
cert=${CALL_TURN_CERT_FILE}
pkey=${CALL_TURN_KEY_FILE}
TLS
else
  echo 'no-tls' >> /tmp/turnserver.conf
fi
exec turnserver -c /tmp/turnserver.conf
