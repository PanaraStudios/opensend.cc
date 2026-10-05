#!/bin/sh
set -eu
CALL_TURN_RELAY_RANGE=${CALL_TURN_RELAY_RANGE:-20800-20999}
if ! printf '%s\n' "$CALL_TURN_RELAY_RANGE" | awk -F- '
  /^[1-9][0-9]*-[1-9][0-9]*$/ && NF == 2 && $1 >= 1024 && $2 <= 65535 && $1 < $2 { valid=1 }
  END { exit !valid }'; then
  echo 'Invalid CALL_TURN_RELAY_RANGE; use START-END within 1024-65535' >&2; exit 1
fi
export CALL_TURN_RELAY_RANGE
case "${CALL_TURN_PASSWORD:-}" in *[!a-zA-Z0-9_-]*|'') echo 'Set CALL_TURN_PASSWORD (32+ safe characters)' >&2; exit 1;; esac
[ "${#CALL_TURN_PASSWORD}" -ge 32 ] || exit 1
case "${CALL_TURN_PUBLIC_IP:-}" in *[!0-9.]*|'') echo 'Set CALL_TURN_PUBLIC_IP to the public IPv4 address' >&2; exit 1;; esac
CALL_TURN_PORT=${CALL_TURN_PORT:-3478}
case $CALL_TURN_PORT in ''|*[!0-9]*|0*) echo 'Invalid CALL_TURN_PORT' >&2; exit 1 ;; esac
[ "${#CALL_TURN_PORT}" -le 5 ] && [ "$CALL_TURN_PORT" -ge 1024 ] && [ "$CALL_TURN_PORT" -le 65535 ] || exit 1
# Generate a private config so the password is absent from the process arguments.
umask 077
cat > /tmp/turnserver.conf <<CONFIG
listening-port=${CALL_TURN_PORT}
min-port=${CALL_TURN_RELAY_RANGE%-*}
max-port=${CALL_TURN_RELAY_RANGE#*-}
external-ip=${CALL_TURN_PUBLIC_IP}
realm=opensend-calling
lt-cred-mech
user=agent:${CALL_TURN_PASSWORD}
fingerprint
no-cli
no-tls
no-dtls
no-multicast-peers
no-loopback-peers
no-tcp-relay
no-software-attribute
log-file=stdout
pidfile=/tmp/turnserver.pid
CONFIG
exec turnserver -c /tmp/turnserver.conf
