# Changelog

## 0.1.0

- Initial release: queueing, batching (including `SendBulkEmail` for templated
  emails), durable delivery via workpools, rate limiting at the account's max
  send rate, enqueue-time idempotency keys, SNS-delivered SES event tracking
  with signature verification, `onEmailEvent` callbacks, manual sends, status
  and cancellation, and retention cleanup functions.
