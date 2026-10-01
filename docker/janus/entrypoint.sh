#!/bin/sh
set -eu
case "${JANUS_API_SECRET:-}" in *[!a-zA-Z0-9_-]*|'') echo 'Set JANUS_API_SECRET (32+ safe characters)' >&2; exit 1;; esac
[ "${#JANUS_API_SECRET}" -ge 32 ] || exit 1
umask 077
if [ ! -s /certs/dtls.crt ] || [ ! -s /certs/dtls.key ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout /certs/dtls.key -out /certs/dtls.crt -days 365 -subj /CN=opensend-janus
fi
openssl pkey -in /certs/dtls.key -text -noout | grep -q 'ASN1 OID: prime256v1'
envsubst '${JANUS_API_SECRET}' < /opt/janus/etc/janus/janus.jcfg.template > /opt/janus/etc/janus/janus.jcfg
set -- /opt/janus/bin/janus --configs-folder=/opt/janus/etc/janus --disable-colors
if [ -n "${JANUS_STUN_SERVER:-}" ]; then set -- "$@" "--stun-server=${JANUS_STUN_SERVER}:${JANUS_STUN_PORT:-19302}"; fi
if [ -n "${JANUS_PUBLIC_IP:-}" ]; then set -- "$@" "--nat-1-1=${JANUS_PUBLIC_IP}" --keep-private-host; fi
exec "$@"
