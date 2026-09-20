#!/usr/bin/env python3
"""Developer workstation setup helper; requires AWS CLI v2. Never sends email.

Read-only by default. --apply creates missing resources and updates ONLY the
named event destination and the helper's own topic-policy statement. It does
not create access keys, edit DNS, or request production access.
"""
import argparse
import json
import re
import subprocess
from urllib.parse import urlparse

EVENTS = ["SEND", "REJECT", "BOUNCE", "COMPLAINT", "DELIVERY", "RENDERING_FAILURE", "DELIVERY_DELAY", "OPEN", "CLICK", "SUBSCRIPTION"]
SID = "K4StackSesEventPublishing"


def run_aws(region, profile, service, operation, **payload):
    command = ["aws", "--region", region, "--output", "json", "--no-cli-pager"]
    if profile:
        command += ["--profile", profile]
    command += [service, operation]
    if payload:
        command += ["--cli-input-json", json.dumps(payload)]
    result = subprocess.run(command, text=True, capture_output=True, timeout=60)
    if result.returncode:
        if "NotFoundException" in result.stderr or "NotFound)" in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def merge_policy(raw, topic_arn, account, config_arn):
    policy = json.loads(raw) if raw else {"Version": "2012-10-17", "Statement": []}
    statements = policy.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]
    policy["Statement"] = [item for item in statements if item.get("Sid") != SID] + [{
        "Sid": SID, "Effect": "Allow", "Principal": {"Service": "ses.amazonaws.com"},
        "Action": "sns:Publish", "Resource": topic_arn,
        "Condition": {"StringEquals": {"AWS:SourceAccount": account}, "ArnEquals": {"AWS:SourceArn": config_arn}},
    }]
    return policy


def dns_records(domain, identity):
    dkim = identity.get("DkimAttributes", {})
    zone = dkim.get("SigningHostedZone")
    # AWS explicitly says the hosted zone can vary by region AND identity.
    if not zone:
        return {"notice": "SigningHostedZone absent: copy exact DKIM CNAME names/values from the SES console. Do not guess the suffix."}
    return [{"type": "CNAME", "name": f"{token}._domainkey.{domain}", "value": f"{token}.{zone}"} for token in dkim.get("Tokens", [])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True)
    parser.add_argument("--account-id", required=True, help="Expected 12-digit AWS account; checked before any writes")
    parser.add_argument("--domain", required=True, help="Developer's sending domain, already owned")
    parser.add_argument("--profile")
    parser.add_argument("--configuration-set", default="k4stack-transactional-dev")
    parser.add_argument("--topic", default="k4stack-ses-events-dev")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--subscribe", help="HTTPS Convex .site webhook URL; requires --apply after Convex env/deploy")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{12}", args.account_id):
        parser.error("--account-id must have 12 digits")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}", args.domain):
        parser.error("--domain must be a lowercase DNS domain, without scheme, path, or email address")
    for name in (args.configuration_set, args.topic):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            parser.error("Use resource names with 1-64 letters, digits, underscores or hyphens (standard SNS topic)")
    if args.subscribe:
        parsed = urlparse(args.subscribe)
        if not args.apply or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
            parser.error("--subscribe requires --apply and an HTTPS endpoint without credentials, port, query or fragment")
    aws = lambda service, operation, **payload: run_aws(args.region, args.profile, service, operation, **payload)
    caller = aws("sts", "get-caller-identity")
    if caller["Account"] != args.account_id:
        raise RuntimeError(f"Wrong AWS account: expected {args.account_id}, got {caller['Account']}")
    partition = caller["Arn"].split(":")[1]
    topic_arn = f"arn:{partition}:sns:{args.region}:{args.account_id}:{args.topic}"
    ses_arn = f"arn:{partition}:ses:{args.region}:{args.account_id}:"
    config_arn = ses_arn + "configuration-set/" + args.configuration_set
    print(f"Target: AWS account {args.account_id}, region {args.region}; {'APPLY' if args.apply else 'READ ONLY'}")
    account = aws("sesv2", "get-account")
    identity = aws("sesv2", "get-email-identity", EmailIdentity=args.domain)
    config = aws("sesv2", "get-configuration-set", ConfigurationSetName=args.configuration_set)
    topic = aws("sns", "get-topic-attributes", TopicArn=topic_arn)
    plan = ["create missing SES domain identity (Easy DKIM 2048)", "create missing configuration set and standard SNS topic", "set topic signature version to 2", "merge scoped SES publish permission into topic policy", "create/update event destination k4stack-events", "enable BOUNCE and COMPLAINT suppression for this configuration set"]
    print("Plan:", json.dumps(plan, indent=2))
    if args.apply:
        if identity is None:
            aws("sesv2", "create-email-identity", EmailIdentity=args.domain, DkimSigningAttributes={"NextSigningKeyLength": "RSA_2048_BIT"})
            identity = aws("sesv2", "get-email-identity", EmailIdentity=args.domain)
        if config is None:
            aws("sesv2", "create-configuration-set", ConfigurationSetName=args.configuration_set)
        aws("sesv2", "put-configuration-set-suppression-options", ConfigurationSetName=args.configuration_set, SuppressedReasons=["BOUNCE", "COMPLAINT"])
        config = aws("sesv2", "get-configuration-set", ConfigurationSetName=args.configuration_set)
        if topic is None:
            aws("sns", "create-topic", Name=args.topic)
            topic = aws("sns", "get-topic-attributes", TopicArn=topic_arn)
        attributes = topic.get("Attributes", {})
        policy = merge_policy(attributes.get("Policy"), topic_arn, args.account_id, config_arn)
        aws("sns", "set-topic-attributes", TopicArn=topic_arn, AttributeName="Policy", AttributeValue=json.dumps(policy))
        aws("sns", "set-topic-attributes", TopicArn=topic_arn, AttributeName="SignatureVersion", AttributeValue="2")
        destinations = aws("sesv2", "get-configuration-set-event-destinations", ConfigurationSetName=args.configuration_set)
        exists = any(d.get("Name") == "k4stack-events" for d in destinations.get("EventDestinations", []))
        aws("sesv2", "update-configuration-set-event-destination" if exists else "create-configuration-set-event-destination", ConfigurationSetName=args.configuration_set, EventDestinationName="k4stack-events", EventDestination={"Enabled": True, "MatchingEventTypes": EVENTS, "SnsDestination": {"TopicArn": topic_arn}})
        if args.subscribe:
            print("Subscription:", json.dumps(aws("sns", "subscribe", TopicArn=topic_arn, Protocol="https", Endpoint=args.subscribe, Attributes={"RawMessageDelivery": "false"}, ReturnSubscriptionArn=True)))
    if identity:
        print("Identity:", json.dumps({"verified": identity.get("VerifiedForSendingStatus"), "dkim": identity.get("DkimAttributes", {}).get("Status"), "dns": dns_records(args.domain, identity), "mailFrom": identity.get("MailFromAttributes")}, indent=2))
    else:
        print("Sending domain identity does not exist yet.")
    print("SES account:", json.dumps({k: account.get(k) for k in ["SendingEnabled", "ProductionAccessEnabled", "SendQuota", "SuppressionAttributes"]}, indent=2))
    print("Configuration-set suppression:", json.dumps((config or {}).get("SuppressionOptions", "inherits account settings"), indent=2))
    print("Convex non-secret settings:", json.dumps({"AWS_REGION": args.region, "AWS_SES_CONFIGURATION_SET": args.configuration_set, "AWS_SES_SNS_TOPIC_ARN": topic_arn}, indent=2))
    print("Runtime IAM policy (scope template/* further if using stored templates):")
    print(json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["ses:SendEmail", "ses:SendBulkEmail"], "Resource": [ses_arn + "identity/" + args.domain, config_arn, ses_arn + "template/*"]}]}, indent=2))
    if topic is not None or args.apply:
        subscriptions = aws("sns", "list-subscriptions-by-topic", TopicArn=topic_arn)
        print("Subscriptions:", json.dumps(subscriptions, indent=2))
    if not args.apply:
        print("No resources changed. Re-run with --apply to perform the listed setup.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        raise SystemExit(str(exc))
