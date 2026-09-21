import { describe, expect, it } from "vitest"
import {
  buildStringToSign,
  extractSubjectPublicKeyInfo,
  isTrustedSnsUrl,
  parseSnsMessage,
  pemToDer,
  SnsVerificationError,
  verifySnsMessage,
  type SnsMessage,
} from "./sns.js"

/**
 * Self-signed test certificate (public only). The matching private key was
 * used once to produce the signatures below and then discarded.
 */
export const TEST_CERT_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"
export const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICyDCCAbACCQCnj38QhlcK2DANBgkqhkiG9w0BAQsFADAmMSQwIgYDVQQDDBtz
bnMudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20wHhcNMjYwOTEyMDgyNjUyWhcNMzYw
OTA5MDgyNjUyWjAmMSQwIgYDVQQDDBtzbnMudXMtZWFzdC0xLmFtYXpvbmF3cy5j
b20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDu+Ocn4bBid9cvImg8
DiZgmwOWLsVG4vG55Uknivf0ss2gmRW+uHcmyeyEmcpzTuuT8FHhgWrcRP44Lo6a
GAEKkN/1wrL1U89n6cso35rrIrKzG8dYKU3wN2SzOnNIYeTmY1aHAT2XuOpC0XJZ
piwbTIsyXZ7mGIigyOM7LczzTHVw3NmCygNvzeaJHVKy5Kj6tkJmMZZbz5MOBfAr
jEBMR4zpS2fSqK0kMczUzzpdZT/P6i9jBo/bKlyGakCk6J7OlFHdWrpr1N/21oYZ
hmTJyTvhsnBcrY3Rs8DIFfOZlIRMAi3C/U552o8gUvW3FFZBmq/i0BxzJhi2XhK4
A+MNAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAH6GJAzClEcsWrZHnky1lkQRLslp
HnTM9KxDplLc9Ka1yIbdb9IeIQM/81cC8GVJCVNabZ72QXBLB2smv8sAEMm80ugJ
pv5r1Oipg0bH1mNeh/zF0gfHXKe6iTVZ6mWx7nX8b2gdCfHCkMELeMobAwGvjI1o
DB4z3Rp+hhoFkQpFP3vNOmhevHfAA8golMaNKh7C0XZ8/d4U6DjOfDoP+i3T/hcV
by++AoL02DDlYxkTJ7t6JpDPD+hWX0VcXYbjJJpfyDCK3ZSqmaGxN1le4/HSjVjI
gaNWkHAZU1CD1lm3TmLcFFlvOKq1PfTbJDJGq7TrT0Wu3EA6YWlnfMAMYk8=
-----END CERTIFICATE-----
`

export const TEST_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:ses-events"

const signedNotificationBase = {
  Type: "Notification",
  MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
  TopicArn: TEST_TOPIC_ARN,
  Message:
    '{"eventType":"Delivery","mail":{"timestamp":"2024-01-01T00:00:00.000Z","messageId":"0100018e8f7b1c2d-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-000000"},"delivery":{"timestamp":"2024-01-01T00:00:12.000Z","recipients":["recipient@example.com"]}}',
  Timestamp: "2024-01-01T00:00:00.000Z",
  SigningCertURL: TEST_CERT_URL,
} as const

/** A Notification signed with SignatureVersion 2 (SHA256withRSA). */
export const SIGNED_NOTIFICATION_V2: SnsMessage = {
  ...signedNotificationBase,
  SignatureVersion: "2",
  Signature:
    "nY9KLRAL2REE7Qty/LeHefZEVUW3mMlSDBUVR9M26qjmtblkj1JKWqQ9F5lPp6ETVwTORCFRQ5gZ+UKJzjphC/jDz9mz2pthoaRvTcdIFf124SlmzyoeAc70/oY/2wMTZBqOX0QnVOUUgVwz3T+8X6RTCO5T4P7wyjF6v6AhiBMbeqaApbrxV3h5oj6S+EoRow1RWcZdMUCKoaWjAoQiSZnuoTuMfg8yA5ezxFXmXSj9UORyh0uNW5kmSzpLiiAQJKoHHetfWK0obaXzO0oT+LiBPRCdu3IjSWxJdZDlYC5nbNfaeQOagAMPMoLpELeB7bT2JNnMqft6CSNzl1iZmA==",
}

/** The same Notification signed with SignatureVersion 1 (SHA1withRSA). */
export const SIGNED_NOTIFICATION_V1: SnsMessage = {
  ...signedNotificationBase,
  SignatureVersion: "1",
  Signature:
    "U6a8KqhxHgywjl0W9iW8OkMsNxkByn+prOfuyLaLjZG1klPE6NX/GZU8j7DmY5NPjImIKkuvf41dIwdPOz4f7tgVWmoWpOEC3x17js8z2c4pz7fHtZwwfHaXAl624LLw38QgaJmNaS1gXSFW7+jfU2DjtDmFv7hnKO/EVWbePJA1PvjfdGRO2O5P0yHP2EMSLehYSTXhrVR79WvGz/s93IC+fTwc4DyN8LaZ2t+1MR6ICYC/T1TqyQwxHCXFpcHzH9weYIg0loAbSHlmTlpEjPeoQNKYROGVD0tXbaLC7WrzMlttL4f4fXV4HK8fLk6qCH1T82lnl+/u3n6lVg8LwA==",
}

export const SIGNED_SUBSCRIPTION_CONFIRMATION: Extract<
  SnsMessage,
  { Type: "SubscriptionConfirmation" }
> = {
  Type: "SubscriptionConfirmation",
  MessageId: "3d891288-136d-417f-bc05-901c108273ee",
  TopicArn: TEST_TOPIC_ARN,
  Message: "You have chosen to subscribe to the topic",
  SubscribeURL:
    "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123",
  Token: "abc123",
  Timestamp: "2024-01-01T00:00:00.000Z",
  SignatureVersion: "2",
  SigningCertURL: TEST_CERT_URL,
  Signature:
    "sao6NjJgo15Pbkj/RWmwcAqS+A8sX9ASGjCImoou506BqMytozl17dgUoHoRFG5icixRVBgmZqLgZQf75XN3vNuA72pww0UBgVdmGO5KUXHJ/NXeH8xMEnfNXR1yct5WasOCDjyqWo8o3Qc5LCSeXqapd+EZucTq7LOYtSR2S8snR6iZ87i7DT4nsgFkM3tH78eSLG9RY0llGb1YcZl9BE5/Pe6OV7KU4UDoTMzPg20RS3ohfYrCxVm76pPnVZct2deNfzFt3yYieZIHilPpCQRsteaHKsLQ2QSrbG1N9rqwcQGJAzqOC95l0OXE2wDASE8asQQnPJ3750rFJwY4Lg==",
}

export const fetchTestCertificate = async (url: string) => {
  if (url !== TEST_CERT_URL) throw new Error(`unexpected cert url ${url}`)
  return TEST_CERT_PEM
}

describe("buildStringToSign", () => {
  it("orders Notification fields and omits an absent Subject", () => {
    expect(buildStringToSign(SIGNED_NOTIFICATION_V2)).toBe(
      "Message\n" +
        `${SIGNED_NOTIFICATION_V2.Message}\n` +
        "MessageId\n22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324\n" +
        "Timestamp\n2024-01-01T00:00:00.000Z\n" +
        `TopicArn\n${TEST_TOPIC_ARN}\n` +
        "Type\nNotification\n"
    )
  })

  it("includes Subject in its sorted position when present", () => {
    const withSubject: SnsMessage = {
      ...SIGNED_NOTIFICATION_V2,
      Subject: "Amazon SES Email Event Notification",
    }
    expect(buildStringToSign(withSubject)).toContain(
      "MessageId\n22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324\nSubject\nAmazon SES Email Event Notification\nTimestamp\n"
    )
  })

  it("uses the confirmation field list for SubscriptionConfirmation", () => {
    const s = buildStringToSign(SIGNED_SUBSCRIPTION_CONFIRMATION)
    expect(
      s.startsWith("Message\nYou have chosen to subscribe to the topic\n")
    ).toBe(true)
    expect(s).toContain("\nSubscribeURL\nhttps://sns.us-east-1.amazonaws.com/")
    expect(s).toContain("\nToken\nabc123\nTopicArn\n")
    expect(s.endsWith("Type\nSubscriptionConfirmation\n")).toBe(true)
  })
})

describe("isTrustedSnsUrl", () => {
  it("accepts HTTPS SNS endpoints in any region, including China", () => {
    expect(isTrustedSnsUrl("https://sns.us-east-1.amazonaws.com/x.pem")).toBe(
      true
    )
    expect(
      isTrustedSnsUrl("https://sns.eu-central-1.amazonaws.com/x.pem")
    ).toBe(true)
    expect(
      isTrustedSnsUrl("https://sns.cn-north-1.amazonaws.com.cn/x.pem")
    ).toBe(true)
  })

  it("rejects plain HTTP, other hosts, and lookalike domains", () => {
    expect(isTrustedSnsUrl("http://sns.us-east-1.amazonaws.com/x.pem")).toBe(
      false
    )
    expect(
      isTrustedSnsUrl("https://sns.us-east-1.amazonaws.com.evil.io/x.pem")
    ).toBe(false)
    expect(isTrustedSnsUrl("https://evil.io/sns.us-east-1.amazonaws.com")).toBe(
      false
    )
    expect(isTrustedSnsUrl("not a url")).toBe(false)
  })
})

describe("certificate parsing", () => {
  it("extracts a SubjectPublicKeyInfo that WebCrypto can import", async () => {
    const spki = extractSubjectPublicKeyInfo(pemToDer(TEST_CERT_PEM))
    const key = await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"]
    )
    expect(key.type).toBe("public")
    expect((key.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(2048)
  })

  it("rejects non-PEM input", () => {
    expect(() => pemToDer("nope")).toThrow(SnsVerificationError)
  })
})

describe("parseSnsMessage", () => {
  it("parses a notification and strips unknown fields", () => {
    const parsed = parseSnsMessage(
      JSON.stringify({
        ...SIGNED_NOTIFICATION_V2,
        MessageAttributes: { foo: { Type: "String", Value: "bar" } },
      })
    )
    expect(parsed.Type).toBe("Notification")
    expect("MessageAttributes" in parsed).toBe(false)
  })

  it("rejects invalid JSON and unknown message types", () => {
    expect(() => parseSnsMessage("{")).toThrow(SnsVerificationError)
    expect(() =>
      parseSnsMessage(
        JSON.stringify({ ...SIGNED_NOTIFICATION_V2, Type: "Other" })
      )
    ).toThrow(SnsVerificationError)
  })
})

describe("verifySnsMessage", () => {
  const verify = (message: SnsMessage) =>
    verifySnsMessage(message, { fetchCertificate: fetchTestCertificate })

  it.each([
    "https://sns.us-east-1.amazonaws.com:444/SimpleNotificationService-test.pem",
    "https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem?x=1",
    "https://sns.us-east-1.amazonaws.com/other.pem",
    "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-test.pem",
  ])(
    "rejects unsafe or mismatched signing certificate URL %s before fetching",
    async (SigningCertURL) => {
      let fetched = false
      await expect(
        verifySnsMessage(
          { ...SIGNED_NOTIFICATION_V2, SigningCertURL },
          {
            fetchCertificate: async () => {
              fetched = true
              return TEST_CERT_PEM
            },
          }
        )
      ).rejects.toThrow(SnsVerificationError)
      expect(fetched).toBe(false)
    }
  )

  it("rejects malformed base64 and inherited signature version names", async () => {
    await expect(
      verify({ ...SIGNED_NOTIFICATION_V2, Signature: "%%%" })
    ).rejects.toThrow(SnsVerificationError)
    await expect(
      verify({ ...SIGNED_NOTIFICATION_V2, SignatureVersion: "constructor" })
    ).rejects.toThrow("Unsupported")
  })

  it("verifies a SignatureVersion 2 notification", async () => {
    await expect(verify(SIGNED_NOTIFICATION_V2)).resolves.toBeUndefined()
  })

  it("verifies a SignatureVersion 1 notification", async () => {
    await expect(verify(SIGNED_NOTIFICATION_V1)).resolves.toBeUndefined()
  })

  it("verifies a subscription confirmation", async () => {
    await expect(
      verify(SIGNED_SUBSCRIPTION_CONFIRMATION)
    ).resolves.toBeUndefined()
  })

  it("rejects a tampered message", async () => {
    await expect(
      verify({ ...SIGNED_NOTIFICATION_V2, Message: '{"eventType":"Bounce"}' })
    ).rejects.toThrow("signature is invalid")
  })

  it("rejects a signature computed with the other hash", async () => {
    await expect(
      verify({ ...SIGNED_NOTIFICATION_V2, SignatureVersion: "1" })
    ).rejects.toThrow("signature is invalid")
  })

  it("rejects unsupported signature versions", async () => {
    await expect(
      verify({ ...SIGNED_NOTIFICATION_V2, SignatureVersion: "3" })
    ).rejects.toThrow("Unsupported SNS SignatureVersion")
  })

  it("never downloads certificates from untrusted URLs", async () => {
    let fetched = false
    await expect(
      verifySnsMessage(
        {
          ...SIGNED_NOTIFICATION_V2,
          SigningCertURL: "https://evil.io/cert.pem",
        },
        {
          fetchCertificate: async () => {
            fetched = true
            return TEST_CERT_PEM
          },
        }
      )
    ).rejects.toThrow("not an Amazon SNS HTTPS endpoint")
    expect(fetched).toBe(false)
  })
})
