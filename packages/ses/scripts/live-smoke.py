#!/usr/bin/env python3
"""Run simulator-only end-to-end checks against an explicitly chosen Convex deployment.
Does not deploy code or change environment variables. Run from packages/ses.
"""
import argparse
import json
import os
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deployment", required=True, help="Exact deployment name from your Convex dashboard")
    parser.add_argument("--from", dest="sender", required=True, help="SES-verified From address")
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--output", default="/tmp/k4stack-ses-live-result.json")
    args = parser.parse_args()
    if args.timeout < 1 or args.timeout > 600:
        parser.error("--timeout must be 1-600 seconds")
    if args.deployment in ("prod", "dev", "local") or ":" in args.deployment or "/" in args.deployment:
        parser.error("Use an exact deployment name, not a moving alias")
    # Do not let ambient deploy keys or self-hosted URL override the target.
    env = {k: v for k, v in os.environ.items() if not k.startswith("CONVEX_")}
    def call(function, payload):
        result = subprocess.run(["pnpm", "exec", "convex", "run", "--deployment", args.deployment, function, json.dumps(payload)], env=env, text=True, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        # Convex formats object results as JS; functions below return a JSON string.
        return json.loads(json.loads(result.stdout))
    print(f"Target: {args.deployment}. Sending five simulator emails; checking a sixth is cancelled.")
    cases = call("smoke:startJson", {"from": args.sender, "runId": str(uuid.uuid4())})
    deadline = time.monotonic() + args.timeout
    while True:
        result = call("smoke:checkJson", {"cases": cases})
        with open(args.output, "w") as output:
            json.dump({"deployment": args.deployment, "cases": result}, output, indent=2)
        print(json.dumps(result, indent=2))
        if all(case["passed"] for case in result):
            print(f"PASS: sends, templates, bounce, complaint, callbacks, enqueue dedupe and cancellation. Evidence: {args.output}")
            return
        if any(case["status"] in ("failed", "missing") for case in result) or time.monotonic() >= deadline:
            raise RuntimeError(f"Live checks did not pass. Inspect {args.output} and the runbook troubleshooting section.")
        time.sleep(3)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        raise SystemExit(str(exc))
