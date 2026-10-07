#!/bin/sh
# The only Docker entry point for this lane; every operation holds the shared lock.
set -eu
(
  export OPENSEND_TELEMETRY=1
  export OPENSEND_TELEMETRY_URL=http://127.0.0.1:9/telemetry
  COMPOSE_PROJECT_NAME=opensend-calling-test-$(date +%s)-$(openssl rand -hex 3)
  export COMPOSE_PROJECT_NAME
  c() { node scripts/test-compose.mjs --calling "$@"; }
  until mkdir "${TMPDIR:-/tmp}/opensend-calling-harness.lock" 2>/dev/null; do sleep 30; done
  if [ ! -f .env.calling-test ]; then
    umask 077
    for name in CALL_GATEWAY_SECRET JANUS_API_SECRET FREESWITCH_ESL_SECRET FREESWITCH_SIP_SECRET FREESWITCH_DIRECTORY_SECRET DRACHTIO_SECRET VOICE_AGENT_SECRET; do
      printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
    done > .env.calling-test
  elif ! grep -q '^VOICE_AGENT_SECRET=.' .env.calling-test; then
    printf 'VOICE_AGENT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.calling-test
  fi
  node scripts/test-stack-env.mjs .env.calling-test
  node scripts/test-compose.mjs --save-project .env.calling-test
  finish() {
    harness_status=$?
    trap - EXIT
    if [ "$harness_status" -ne 0 ]; then c logs --tail=150 call-gateway voice-agent freeswitch || true; fi
    c down --remove-orphans || true
    rmdir "${TMPDIR:-/tmp}/opensend-calling-harness.lock"
    exit "$harness_status"
  }
  trap finish EXIT
  trap 'exit 130' INT TERM
  c build janus freeswitch drachtio voice-agent call-gateway meta-peer
  # Match installer startup: Convex mounts the empty volume before FreeSWITCH.
  c run --rm --no-deps --entrypoint node convex \
    -e 'require("node:fs").accessSync("/recordings")'
  c up -d janus freeswitch drachtio voice-agent call-gateway
  if [ "$#" -eq 0 ]; then
    set -- playground playground-bot baseline agent voice bot-engine bot-end-call ivr-engine ivr-bot-agent bot-ivr outbound-bot outbound-ivr
  fi
  harness_recordings=no
  for harness_mode in "$@"; do
    case "$harness_mode" in
      playground|playground-bot|baseline|agent|voice|bot-engine|bot-end-call|ivr-engine|ivr-bot-agent|bot-ivr|outbound-bot|outbound-ivr) ;;
      *) echo "Unknown calling harness mode: $harness_mode" >&2; exit 2 ;;
    esac
    case "$harness_mode" in
      playground|playground-bot) ;;
      *) harness_recordings=yes ;;
    esac
    c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts "$harness_mode"
  done
  # The fake callback receiver cannot test Convex storage. Exercise the real
  # backend image's Node user and production mount against the finalized WAVs.
  if [ "$harness_recordings" = yes ]; then
    c run --rm --no-deps --entrypoint node \
      --volume "$(pwd)/scripts/test-calling-recordings.mjs:/test-recordings.mjs:ro" \
      convex /test-recordings.mjs
  fi
)
