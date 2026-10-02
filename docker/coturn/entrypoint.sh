#!/bin/sh
set -eu
case "${CALL_TURN_PASSWORD:-}" in *[!a-zA-Z0-9_-]*|'') echo 'Set CALL_TURN_PASSWORD (32+ safe characters)' >&2; exit 1;; esac
[ "${#CALL_TURN_PASSWORD}" -ge 32 ] || exit 1
case "${CALL_TURN_PUBLIC_IP:-}" in *[!0-9.]*|'') echo 'Set CALL_TURN_PUBLIC_IP to the public IPv4 address' >&2; exit 1;; esac
# Generate a private config so the password is absent from the process arguments.
umask 077
cat > /tmp/turnserver.conf <<CONFIG
listening-port=3478
min-port=20800
max-port=20999
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
