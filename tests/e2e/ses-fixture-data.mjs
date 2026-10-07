// Synthetic ciphertext cannot authenticate an AWS request. Shared by browser
// e2e seeding and the component harness; neither test contacts SES.
export const syntheticSesConnection = Object.freeze({
  accountId: "123456789012",
  credentialKind: "keys",
  encryptedCredentials: "test-fixture-no-aws-access",
  accessKeyLast4: "TEST",
  defaultRegion: "us-east-1",
  credentialRevision: 1,
})

// Same SES event envelope used by convex/sesProjection.test.ts. Inject it at
// the existing admin-only ses/state:ingest boundary, after SNS verification.
export function sesFixtureNotification({
  eventType,
  emailId,
  teamId,
  recipient,
  messageId,
  timestamp = new Date().toISOString(),
}) {
  const fields = { Send: "send", Delivery: "delivery", Bounce: "bounce" }
  if (!(eventType in fields))
    throw new Error(`Unsupported fixture event ${eventType}`)
  return {
    eventType,
    mail: {
      messageId,
      timestamp,
      destination: [recipient],
      tags: { opensend_email: [emailId], opensend_team: [teamId] },
    },
    [fields[eventType]]: {
      timestamp,
      ...(eventType === "Bounce"
        ? {
            bounceType: "Permanent",
            bounceSubType: "General",
            bouncedRecipients: [
              {
                emailAddress: recipient,
                diagnosticCode: "550 mailbox unavailable",
              },
            ],
          }
        : { recipients: [recipient] }),
    },
  }
}
