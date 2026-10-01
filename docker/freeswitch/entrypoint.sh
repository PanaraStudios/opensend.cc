#!/bin/sh
set -eu
for value in "${FREESWITCH_ESL_SECRET:-}" "${FREESWITCH_SIP_SECRET:-}" "${FREESWITCH_AGENT_SECRET:-}"; do
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
    -keyout /certs/wss.key -out /certs/wss.crt -days 365 -subj /CN=opensend-freeswitch
  cat /certs/wss.key /certs/wss.crt > /certs/wss.pem
fi
# FreeSWITCH's independent DTLS certificate also uses P-256.
if [ ! -s /opt/freeswitch/certs/dtls-srtp.pem ]; then
  mkdir -p /opt/freeswitch/certs
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout /opt/freeswitch/certs/dtls.key -out /opt/freeswitch/certs/dtls.crt -days 365 -subj /CN=opensend-freeswitch-dtls
  cat /opt/freeswitch/certs/dtls.key /opt/freeswitch/certs/dtls.crt > /opt/freeswitch/certs/dtls-srtp.pem
fi
envsubst '${FREESWITCH_ESL_SECRET} ${FREESWITCH_PUBLIC_IP}' < /templates/freeswitch.xml.template > /opt/freeswitch/conf/freeswitch.xml
# Bounded per-call gateway slots; browser-agent credentials use a separate secret.
i=1000
while [ "$i" -le 1099 ]; do
  printf '<include><user id="%s"><params><param name="password" value="%s"/></params><variables><variable name="user_context" value="calling"/></variables></user></include>\n' \
    "$i" "$FREESWITCH_SIP_SECRET" > "/opt/freeswitch/conf/directory/$i.xml"
  i=$((i + 1))
done
i=2000
while [ "$i" -le 2099 ]; do
  printf '<include><user id="%s"><params><param name="password" value="%s"/></params><variables><variable name="user_context" value="agents"/></variables></user></include>\n' \
    "$i" "$FREESWITCH_AGENT_SECRET" > "/opt/freeswitch/conf/directory/$i.xml"
  i=$((i + 1))
done
exec /opt/freeswitch/bin/freeswitch -nf -nonat
