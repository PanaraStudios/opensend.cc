#!/bin/sh
# Run from this worktree's root. Never operate on another Compose project.
(
  c() {
    docker compose --env-file .env.calling-test -f compose.yaml -f docker/compose.calling-test.yaml --profile calling --profile calling-test -p opensend-calling-test "$@"
  }
  until mkdir /private/tmp/opensend-calling-harness.lock 2>/dev/null; do
    echo 'Waiting for opensend-calling-test harness lock'
    sleep 30
  done
  trap 'harness_status=$?; c down --remove-orphans; rmdir /private/tmp/opensend-calling-harness.lock; exit "$harness_status"' EXIT
  set -e
  c build drachtio janus freeswitch call-gateway meta-peer
  c up -d drachtio janus freeswitch call-gateway
  c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts playground
  c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts ivr-engine
  c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts voice
  c run --rm --no-deps --use-aliases meta-peer
  c run --rm --no-deps --use-aliases meta-peer node node_modules/tsx/dist/cli.mjs scripts/meta-peer.ts agent
)
