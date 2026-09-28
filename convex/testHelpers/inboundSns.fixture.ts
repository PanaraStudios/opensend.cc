import type { SnsMessage } from "../ses/sns"
/**
 * SNS envelopes for the inbound topic, signed once with a throwaway key that
 * was then discarded. Only the self-signed certificate is kept.
 */
export const INBOUND_TOPIC_ARN =
  "arn:aws:sns:us-east-1:123456789012:opensend-inbound-test"
export const INBOUND_BUCKET = "opensend-inbound-test-bucket"
export const INBOUND_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUBzKpaC7enWaLydTXDKyMBHuKhEQwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbc25zLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tMB4XDTI2
MDkyODAxMTIwNFoXDTM2MDkyNTAxMTIwNFowJjEkMCIGA1UEAwwbc25zLnVzLWVh
c3QtMS5hbWF6b25hd3MuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEA0YsEUJ+8eZswlYBVOV8r0hcTPtwdJCBMXFZT8U/3x8+cwUVHCceL9jpe1leb
QskXxm3vhJzkvE1jEjWlEgVxZ3EBbvxl6ydbKrS5tFel6nWA0iSctD0Y0h0a4WpZ
/Pumk/zBwSnY+kPqE1xf9a6jETCqYFwCLdfr0/3OmWuQmeFoZ9i3EdB+HzMrt8e4
TS7wAopgAG1V8hneWFsLq+ETuiIgrVUwpEs5gyPX1BQuHuy3nO37hmorWIc7ahjx
eTpX+mA1TmSAGkHRIyK4oxbAUrcLiYdX7olGCt3u8OSMsEJUDAwmorGi8Ctsul4R
UzEjfRSm5XjYL6bFa7iYdJWfrQIDAQABo1MwUTAdBgNVHQ4EFgQUkVkeU2ooQEb2
Ga7DvMDkK8nZhYQwHwYDVR0jBBgwFoAUkVkeU2ooQEb2Ga7DvMDkK8nZhYQwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAL+hUf7NvVuUq/r/qyX56
6pB35goIIndJaW+C95LBi07AbDnQ/yf+ftEg4wncqsdtPW1y6Dt/+xy7KEg0+vxT
8MqGf/3C6w4wkjboY5wPm26vnDFlGJgV9aYMOgFsE0Qql3OHLU5F0q/KkVgOEiUq
IM0HJrgs1NMqhq+X8/DxMT5KPhzx0hceoDb5ykordTA+kYLkq4KTiFolyIjiRsbg
rPzHED+Ooos2u6CY8MZ8UcR+BCniBGmeBsAB/TsLPYlrvEo3vROXRQIJA/GlUBtl
3+GTerCY4mzG50TvNwrNknvxNmvlNxiPbd3TTEsHwFRxrC8RkJwG+Z2e3xVctRNU
MQ==
-----END CERTIFICATE-----
`

export const INBOUND_NOTIFICATION: SnsMessage = {
  TopicArn: "arn:aws:sns:us-east-1:123456789012:opensend-inbound-test",
  Timestamp: "2026-09-28T00:00:00.000Z",
  SigningCertURL:
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-inbound-test.pem",
  Type: "Notification",
  MessageId: "7f1c1c52-0d8e-4a53-9a3f-inbound-0001",
  Message:
    '{"notificationType":"Received","mail":{"timestamp":"2026-09-28T00:00:00.000Z","source":"sender@example.org","messageId":"ses-message-0001","destination":["hello@mail.example.test"],"commonHeaders":{"subject":"Hello"}},"receipt":{"timestamp":"2026-09-28T00:00:00.000Z","recipients":["hello@mail.example.test"],"spamVerdict":{"status":"PASS"},"virusVerdict":{"status":"PASS"},"action":{"type":"S3","topicArn":"arn:aws:sns:us-east-1:123456789012:opensend-inbound-test","bucketName":"opensend-inbound-test-bucket","objectKeyPrefix":"domain/","objectKey":"domain/ses-message-0001"}}}',
  SignatureVersion: "2",
  Signature:
    "wPibFWd+v0O4AKJ/qEvvZJfTcmzI92tKYFf57+s11mrZgMSDousXIBH8+jLQKFRfj9C6sbfx9RekGq2X4fkvlKiD/F0STL7f6gW8jnXgGFeP8kPCqAJG4eAXRdbEiXxG5D0X5H26nVM4PYkDPv+P139pnfakQI23I66dz8635MNf7KT/26wmCS3P9t3aWSoIbWBHVJGPNU/5qv4kgl3Y71p7RDM2+zO2Z7CxHqXoloAmfJeX7CT6mMUMyEn6ii9hZURQBZsjY2VLLc9JPwwN/q0BBVZ6j1ZscJLHni0uALOifcuyOT/mmXliy+E+YgspUkhO9+HuGSAh+/GY+TUXLA==",
}

export const INBOUND_UNROUTED: SnsMessage = {
  TopicArn: "arn:aws:sns:us-east-1:123456789012:opensend-inbound-test",
  Timestamp: "2026-09-28T00:00:00.000Z",
  SigningCertURL:
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-inbound-test.pem",
  Type: "Notification",
  MessageId: "7f1c1c52-0d8e-4a53-9a3f-inbound-0002",
  Message:
    '{"notificationType":"Received","mail":{"timestamp":"2026-09-28T00:00:00.000Z","source":"sender@example.org","messageId":"ses-message-0002","destination":["hello@unknown.example.test"],"commonHeaders":{"subject":"Hello"}},"receipt":{"timestamp":"2026-09-28T00:00:00.000Z","recipients":["hello@unknown.example.test"],"spamVerdict":{"status":"PASS"},"virusVerdict":{"status":"PASS"},"action":{"type":"S3","topicArn":"arn:aws:sns:us-east-1:123456789012:opensend-inbound-test","bucketName":"opensend-inbound-test-bucket","objectKeyPrefix":"domain/","objectKey":"domain/ses-message-0002"}}}',
  SignatureVersion: "2",
  Signature:
    "l2addMCadk9efKLo7aq2TqbE6Pt/SFHGzuyINNUhl0le2K95MMIXwRR6NhctpO8m/AY33swFciNTDTYme/5ug115lOZ4WBQ5r6jJdJ7o8qzrJZ4+AgT0U7inrhPpLAQVaqT9pIwKC7kIMgG8R2rxa4vdug/ok/3+e6GLffs2XzibTs4rR/UA8HzFRyUBuhu5X6Rh3l/LfTcCwBL3gHw3TxGtrtIZ8ADUyVRSYLvu0kepEQziBmXVR6sm+tXBMv5DuPw/uRtl2Tm7ilESIqs3dbZpBX/VPEA/WdB+otJF6h39am6phFLisW83ENYmtuKVyF8LNZwOtO0XbkjPxrII8g==",
}

export const INBOUND_SUBSCRIPTION_CONFIRMATION: SnsMessage = {
  TopicArn: "arn:aws:sns:us-east-1:123456789012:opensend-inbound-test",
  Timestamp: "2026-09-28T00:00:00.000Z",
  SigningCertURL:
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-inbound-test.pem",
  Type: "SubscriptionConfirmation",
  MessageId: "7f1c1c52-0d8e-4a53-9a3f-inbound-0003",
  Token: "inbound-confirmation-token",
  Message: "You have chosen to subscribe to the topic.",
  SubscribeURL:
    "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
  SignatureVersion: "2",
  Signature:
    "ntL5HbcMqvH0PG5PJqzKAN/INJEq7cbXap9y1XHIB0++iXTECyWG0ZhaPCIR4rYzUMso1Gy1XgLS6EX6WmOKRW9Xi5bBOQK5RG6b7KNDPnAPfLtMxcbdnG+ssMUWJs1zWmBpxPCQz5eKPHIiWdtCnQ86o0Rh8iGuLUZwaVjri7+194u+Dq6ZhI5AnlysAeaF/W2SlbaWph38gdC4m2wPvhFyjEzFoWD3TFzBAjQQdo4bl2DJR3AfMcwOhwTrFIs0UVZUwIlrQm3/olFvNKeKcjBqMfCySS9YKq7pMYlA+DzzD3xDu3Y4ZMVizG923573tqGDyqUL9Kej2kxtMaqzfw==",
}
