import assert from "node:assert/strict"
import { test } from "node:test"
import { emailFailureMessage } from "./email-failure"
test("SES failures explain credentials, verification, throttling, suppression and rejection", () => {
  const cases = [
    [
      "InvalidClientTokenId: The security token included in the request is invalid",
      /credentials.*invalid/,
    ],
    ["SignatureDoesNotMatch: Signature mismatch", /credentials.*invalid/],
    [
      "MessageRejected: Email address is not verified. sandbox",
      /unverified address/,
    ],
    ["TooManyRequestsException: limit", /sending limit/],
    ["LimitExceededException: daily quota exceeded", /sending limit/],
    ["Recipient suppressed", /recipient is suppressed/],
    ["MessageRejected: content", /SES rejected/],
    [
      "AWS operation failed (InternalFailure). Retry or check the AWS configuration.",
      /could not send/,
    ],
  ] as const
  for (const [reason, pattern] of cases)
    assert.match(emailFailureMessage(reason), pattern)
  assert.equal(
    emailFailureMessage("The sending domain was removed"),
    "The sending domain was removed"
  )
})
