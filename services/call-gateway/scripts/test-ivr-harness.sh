#!/bin/sh
# Shared locked harness covers playground, IVR, Pipecat and combined handoffs.
set -eu
exec sh scripts/test-calling-harness.sh "$@"
