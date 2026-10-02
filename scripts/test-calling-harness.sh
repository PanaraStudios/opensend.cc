#!/bin/sh
# The only Docker entry point for this lane; every operation holds the shared lock.
set -eu
(
  c() { docker compose --env-file .env.calling-test -f compose.yaml -f docker/compose.calling-test.yaml --profile calling --profile calling-test -p opensend-calling-test "$@"; }
  if [ ! -f .env.calling-test ]; then
    umask 077
    for name in CALL_GATEWAY_SECRET JANUS_API_SECRET FREESWITCH_ESL_SECRET FREESWITCH_SIP_SECRET FREESWITCH_DIRECTORY_SECRET DRACHTIO_SECRET VOICE_AGENT_SECRET; do
      printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
    done > .env.calling-test
  elif ! rg -q '^VOICE_AGENT_SECRET=.' .env.calling-test; then
    printf 'VOICE_AGENT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.calling-test
  fi
  until mkdir /private/tmp/opensend-calling-harness.lock 2>/dev/null; do sleep 30; done
  finish() {
    harness_status=$?
    trap - EXIT
    if [ "$harness_status" -ne 0 ]; then c logs --tail=150 call-gateway voice-agent freeswitch || true; fi
    c down --remove-orphans || true
    rmdir /private/tmp/opensend-calling-harness.lock
    exit "$harness_status"
  }
  trap finish EXIT
  trap 'exit 130' INT TERM
  c build janus freeswitch drachtio voice-agent call-gateway meta-peer
  c up -d janus freeswitch drachtio voice-agent call-gateway
  if [ "$#" -eq 0 ]; then
    set -- playground playground-bot baseline agent voice bot-engine bot-end-call ivr-engine ivr-bot-agent bot-ivr
  fi
  for harness_mode in "$@"; do
    case "$harness_mode" in
      playground|playground-bot|baseline|agent|voice|bot-engine|bot-end-call|ivr-engine|ivr-bot-agent|bot-ivr) ;;
      *) echo "Unknown calling harness mode: $harness_mode" >&2; exit 2 ;;
    esac
    c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts "$harness_mode"
  done
)
