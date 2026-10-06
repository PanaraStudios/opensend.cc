#!/bin/sh
set -eu
FREESWITCH_RTP_RANGE=${FREESWITCH_RTP_RANGE:-20400-20799}
if ! printf '%s\n' "$FREESWITCH_RTP_RANGE" | awk -F- '
  /^[1-9][0-9]*-[1-9][0-9]*$/ && NF == 2 && $1 >= 1024 && $2 <= 65535 && $1 < $2 { valid=1 }
  END { exit !valid }'; then
  echo 'Invalid FREESWITCH_RTP_RANGE; use START-END within 1024-65535' >&2; exit 1
fi
FREESWITCH_RTP_START=${FREESWITCH_RTP_RANGE%-*}
FREESWITCH_RTP_END=${FREESWITCH_RTP_RANGE#*-}
export FREESWITCH_RTP_RANGE FREESWITCH_RTP_START FREESWITCH_RTP_END
for value in "${FREESWITCH_ESL_SECRET:-}" "${FREESWITCH_SIP_SECRET:-}" "${FREESWITCH_DIRECTORY_SECRET:-}"; do
  case "$value" in *[!a-zA-Z0-9_-]*|'') echo 'Set FreeSWITCH secrets (32+ safe characters)' >&2; exit 1;; esac
  [ "${#value}" -ge 32 ] || exit 1
done
FREESWITCH_PUBLIC_IP=${FREESWITCH_PUBLIC_IP:-auto}
export FREESWITCH_PUBLIC_IP
case "$FREESWITCH_PUBLIC_IP" in *[!a-zA-Z0-9.:-]*|'') exit 1;; esac
umask 077
# Self-signed P-256 is fine for DTLS; production WSS needs a trusted hostname cert.
if [ ! -s /certs/wss.pem ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout /certs/wss.key -out /certs/wss.crt -days 365 -subj /CN=localhost -addext "subjectAltName=DNS:localhost,DNS:freeswitch,IP:127.0.0.1"
  cat /certs/wss.key /certs/wss.crt > /certs/wss.pem
fi
# FreeSWITCH's independent DTLS certificate also uses P-256.
if [ ! -s /opt/freeswitch/certs/dtls-srtp.pem ]; then
  mkdir -p /opt/freeswitch/certs
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout /opt/freeswitch/certs/dtls.key -out /opt/freeswitch/certs/dtls.crt -days 365 -subj /CN=opensend-freeswitch-dtls
  cat /opt/freeswitch/certs/dtls.key /opt/freeswitch/certs/dtls.crt > /opt/freeswitch/certs/dtls-srtp.pem
fi
# No static directory fallback: unknown/expired agents must fail closed.
rm -f /opt/freeswitch/conf/directory/*.xml
envsubst '${FREESWITCH_ESL_SECRET} ${FREESWITCH_PUBLIC_IP} ${FREESWITCH_DIRECTORY_SECRET} ${FREESWITCH_RTP_START} ${FREESWITCH_RTP_END}' < /templates/freeswitch.xml.template > /opt/freeswitch/conf/freeswitch.xml
# Our rendered config lives in /opt/freeswitch/conf, not the stock etc/freeswitch samples.
mkdir -p /opt/freeswitch/log /opt/freeswitch/db
exec /opt/freeswitch/bin/freeswitch -nf -nonat -conf /opt/freeswitch/conf -log /opt/freeswitch/log -db /opt/freeswitch/db
