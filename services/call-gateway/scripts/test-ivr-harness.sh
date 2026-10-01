#!/bin/sh
# The shared harness includes the IVR DTMF, Pipecat and combined handoff flows.
set -eu
exec sh scripts/test-calling-harness.sh "$@"
