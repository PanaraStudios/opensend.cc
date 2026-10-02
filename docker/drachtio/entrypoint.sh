#!/bin/sh
set -eu
case "${DRACHTIO_SECRET:-}" in
  *[!a-zA-Z0-9_-]*|'') echo 'Invalid DRACHTIO_SECRET' >&2; exit 1 ;;
esac
[ "${#DRACHTIO_SECRET}" -ge 32 ] && [ "${#DRACHTIO_SECRET}" -le 128 ] || exit 1
umask 077
cat > /run/drachtio/config.xml <<EOF_CONFIG
<drachtio>
  <admin port="9022" secret="${DRACHTIO_SECRET}">0.0.0.0</admin>
  <sip><contacts><contact>sip:*:5060;transport=udp,tcp</contact></contacts></sip>
  <logging><console/><loglevel>warning</loglevel><sofia-loglevel>0</sofia-loglevel></logging>
</drachtio>
EOF_CONFIG
exec drachtio --file /run/drachtio/config.xml
