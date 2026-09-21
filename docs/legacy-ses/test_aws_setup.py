"""Offline checks for account targeting, safe defaults, IAM scope and DNS output."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("aws_setup", Path(__file__).with_name("aws-setup.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_policy_preserves_other_statements_and_scopes_ses(self):
        original = {"Version": "2012-10-17", "Statement": [{"Sid": "Existing", "Effect": "Deny"}]}
        result = setup.merge_policy(json.dumps(original), "topic", "123", "config")
        self.assertEqual(result["Statement"][0], original["Statement"][0])
        self.assertEqual(result["Statement"][1]["Condition"], {"StringEquals": {"AWS:SourceAccount": "123"}, "ArnEquals": {"AWS:SourceArn": "config"}})
        self.assertEqual(setup.merge_policy(json.dumps(result), "topic", "123", "config"), result)

    def test_dkim_uses_aws_hosted_zone_without_guessing(self):
        records = setup.dns_records("example.com", {"DkimAttributes": {"Tokens": ["abc"], "SigningHostedZone": "dkim.region.amazonses.com"}})
        self.assertEqual(records[0]["value"], "abc.dkim.region.amazonses.com")
        self.assertIn("notice", setup.dns_records("example.com", {"DkimAttributes": {"Tokens": ["abc"]}}))

    def test_default_never_writes(self):
        calls = []
        def aws(region, profile, service, operation, **payload):
            calls.append(operation)
            if operation == "get-caller-identity":
                return {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/test"}
            return {} if operation == "get-account" else None
        with patch.object(setup, "run_aws", side_effect=aws), patch("sys.argv", ["setup", "--region", "us-east-1", "--account-id", "123456789012", "--domain", "example.com"]), contextlib.redirect_stdout(io.StringIO()):
            setup.main()
        self.assertTrue(all(operation.startswith("get-") for operation in calls))

    def test_wrong_account_fails_before_any_resource_call(self):
        with patch.object(setup, "run_aws", return_value={"Account": "000000000000"}) as aws, patch("sys.argv", ["setup", "--region", "us-east-1", "--account-id", "123456789012", "--domain", "example.com", "--apply"]):
            with self.assertRaisesRegex(RuntimeError, "Wrong AWS account"):
                setup.main()
        self.assertEqual(aws.call_count, 1)

    def test_existing_identity_is_not_recreated_when_applying(self):
        calls = []
        def aws(region, profile, service, operation, **payload):
            calls.append(operation)
            if operation == "get-caller-identity":
                return {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/test"}
            if operation == "get-email-identity": return {"VerifiedForSendingStatus": True}
            if operation == "get-topic-attributes": return {"Attributes": {"Policy": '{"Statement":[]}'}}
            if operation == "get-configuration-set-event-destinations": return {"EventDestinations": [{"Name": "k4stack-events"}]}
            return {}
        with patch.object(setup, "run_aws", side_effect=aws), patch("sys.argv", ["setup", "--region", "us-east-1", "--account-id", "123456789012", "--domain", "example.com", "--apply"]), contextlib.redirect_stdout(io.StringIO()):
            setup.main()
        self.assertNotIn("create-email-identity", calls)
        self.assertIn("update-configuration-set-event-destination", calls)
        self.assertIn("put-configuration-set-suppression-options", calls)

if __name__ == "__main__":
    unittest.main()
