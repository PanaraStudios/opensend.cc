import type { SnsMessage } from "../ses/sns"
/**
 * Self-signed test certificate (public only). The matching private key was
 * used once to produce the signatures below and then discarded.
 */
export const TEST_CERT_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"
export const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICwDCCAagCAQEwDQYJKoZIhvcNAQELBQAwJjEkMCIGA1UEAwwbc25zLnVzLWVh
c3QtMS5hbWF6b25hd3MuY29tMB4XDTI0MDEwMTAwMDAwMFoXDTM2MDEwMTAwMDAw
MFowJjEkMCIGA1UEAwwbc25zLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA13ZSB6wUFGK8kJ12e9wlgEEP6Dvv
DYvgTS+Gc2GT67sBcqowgSWgT0U7NFMrNohchiyhrsCEEdthizsoTOtpA16blR88
xV21PnpcAqZRiPYomPTvB+WkGNITsYQhNJCOSM+77r/Vqg+b1VuOoM5VJKgQV/KZ
1Vgcgpnx1sZOXRITU5fZeKRf1N86FwIXxNcTXLN/JFRXQwXCoYv+niYIdcYA/OgX
eifa0KuiKusnVAOqolfdlODbRo0vcLVrQ8fL84glVSjnL2JAuq7hF2lk5h+jRl9q
xeWns5vsUHRiUgeE8d2FVCdjP8ercWvZjVcgFK1/D5r6ZpW3OlkHiCfqlwIDAQAB
MA0GCSqGSIb3DQEBCwUAA4IBAQDGKtIjiFSyZ1e2P51L+h+Qr19eDXWyieUXN/zH
fHHFoox3cFz6wzHdT39UzeiLUcfo51absCKh9W1Hqd3U0tN9qi0diEV8lvB9J1x4
i0N5GmbJ1umCMrdTW/B4w6ct/roEKWpzWHm0mEi/Atp0iSoZ0ZgiEpXv57yInd7x
DayM9YtZIiyQU9YY0YPY4tydaEkjtJ7dif1O53Lz6b1CvJwSV1Z0YdaeIyX9DNWQ
zZn8MwQWzIpuuuxyPaZmyswo7XAs1Vi+LHI+xhtwmBs9JAc2BRqxK88xh06v0Kuj
ng0UU3sYZIxOiEBGwXpaXF+0cuEdiiukn67aW4/AXq7ciSiy
-----END CERTIFICATE-----
`

export const TEST_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:ses-events"

const signedNotificationBase = {
  Type: "Notification",
  MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
  TopicArn: TEST_TOPIC_ARN,
  Message:
    '{"eventType":"Delivery","mail":{"timestamp":"2024-01-01T00:00:00.000Z","messageId":"0100018e8f7b1c2d-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-000000"},"delivery":{"timestamp":"2024-01-01T00:00:12.000Z","recipients":["recipient@example.com"]}}',
  Timestamp: "2026-09-28T00:00:00.000Z",
  SigningCertURL: TEST_CERT_URL,
} as const

/** A Notification signed with SignatureVersion 2 (SHA256withRSA). */
export const SIGNED_NOTIFICATION_V2: SnsMessage = {
  ...signedNotificationBase,
  SignatureVersion: "2",
  Signature:
    "yaXYshVgmR+yXut8ptsC6bzgQjcCkh/DQy1kZLPqSc4uBEOVX64yAPInEBfmJ/Dku5Da0oBPMVPDx5ulZD9zGuPKLo4Akb4XwgFY1StbUBhndjmRQyvWYhJnqX8msjRupcmBfZJDX/Xca8WtSdYq3s+Obh7agXGCBxWUiy7kL4oEYlKhWFrbZmIW11h9eEb2ZyQiOFV1kZN32Za2Y8BJkwd5jJrDgMywhDw+S3ZZ1IV6GTtg5o6ab6MHd83ifKkCvq9Ji5mLrvw3GqX1sPjtsIz5MHHSOAty7LJVhdHw+4JzbRuBIHji0TOKMok4Mw0LT27RqY2nSPgaIEZvV2o/pQ==",
}

/** The same Notification signed with SignatureVersion 1 (SHA1withRSA). */
export const SIGNED_NOTIFICATION_V1: SnsMessage = {
  ...signedNotificationBase,
  SignatureVersion: "1",
  Signature:
    "SGQphA2dwMvlKZRyXr57QB2eHW/apdt27XS29N8uL5HLiHPwLGQjXD3voI1vx6TEskyo+BDPc08VwOpQTsb/elp4HPu91dH1NqKIfIAx3tEaz3J2e1Fs+O5K2YCAXO6hRCDlTInDUBNIWN7nKx7+ThQCldusb2H55S5NI5uMaGHGetVg87/TvLewps8a2wtpwCm0JT76UAl7NPQOPDid1nm6YPMcN8wbHPjfgXMgWWoV6kIobyk8pT/Uo+kv715IwItn1E5Gmrb/9skGqOB+6T69si1hKTX4n8EZ3+/Pd992UzztGawe51DY5yc7Hs0imwfjtmyEwiq88ZjJgJ/Q4w==",
}

export const SIGNED_SUBSCRIPTION_CONFIRMATION: SnsMessage = {
  Type: "SubscriptionConfirmation",
  MessageId: "3d891288-136d-417f-bc05-901c108273ee",
  TopicArn: TEST_TOPIC_ARN,
  Message: "You have chosen to subscribe to the topic",
  SubscribeURL:
    "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123",
  Token: "abc123",
  Timestamp: "2026-09-28T00:00:00.000Z",
  SignatureVersion: "2",
  SigningCertURL: TEST_CERT_URL,
  Signature:
    "rU75OkdhiIlfsgQi3EaoMl89w/aHixeLcKx2+oryRfdHfcI4VLiqF97VyJfL/5AkUW0sHlq28N0reGT8cxKV4+NQAigpR96a/ZGS0QRlMDMZUVhID/OgLlUzl5T4Bd02KmdY2zwbjqlkUQwNgPy++4kLw4jElq+I0GgpF/5AJwnlQFDId527pkctC7aQWyL4jIkDwteI/rE0i4vxGUsJHmsUatrbj8GWSRg1J8uV0Kmdn3rE7NHQe9sJcQ+6Z+3Dc4aorEvVWilLPc6DvNqi9vnCZIwlU55pFMySELK04IVhmYD5XXtrQ+5hyHjk63irO4p5eJ3QXJEZd5y+MmKVEA==",
}
