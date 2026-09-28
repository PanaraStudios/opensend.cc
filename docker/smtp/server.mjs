import { SMTPServer } from "smtp-server"
import { simpleParser } from "mailparser"

export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024
const MAX_JSON_BYTES = 42 * 1024 * 1024
const transportHeaders = new Set([
  "from",
  "sender",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
  "return-path",
  "received",
  "dkim-signature",
  "authentication-results",
  "resend-idempotency-key",
])
const smtpError = (message, responseCode) =>
  Object.assign(new Error(message), { responseCode })
const addresses = (field) =>
  (Array.isArray(field) ? field : [field]).flatMap((item) => item?.value ?? [])
const mailbox = ({ name, address }) =>
  name ? `${JSON.stringify(name)} <${address}>` : address

/** Only envelope recipients receive mail. Recipients absent from To/Cc are Bcc. */
export async function parseMessage(raw, recipients) {
  const mail = await simpleParser(raw, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  })
  const senders = addresses(mail.from)
  if (senders.length !== 1 || !senders[0].address)
    throw smtpError("A single From address is required", 554)
  const remaining = new Set(recipients.map((address) => address.toLowerCase()))
  const select = (field) =>
    addresses(field).flatMap((address) => {
      if (!address.address || !remaining.delete(address.address.toLowerCase()))
        return []
      return [mailbox(address)]
    })
  const to = select(mail.to)
  const cc = select(mail.cc)
  const bcc = [...select(mail.bcc), ...remaining]
  const headers = {}
  let idempotencyKey
  for (const { key, line } of mail.headerLines) {
    const value = line
      .slice(line.indexOf(":") + 1)
      .replace(/\r?\n[ \t]+/g, " ")
      .trim()
    if (key === "resend-idempotency-key") {
      if (idempotencyKey !== undefined)
        throw smtpError("Duplicate idempotency header", 554)
      idempotencyKey = value
    } else if (
      !transportHeaders.has(key) &&
      !key.startsWith("x-ses-") &&
      !key.startsWith("arc-")
    ) {
      if (headers[key] !== undefined)
        throw smtpError("Duplicate custom header", 554)
      headers[key] = value
    }
  }
  if (
    idempotencyKey !== undefined &&
    (!idempotencyKey ||
      idempotencyKey.length > 256 ||
      /[^\x21-\x7e]/.test(idempotencyKey))
  )
    throw smtpError("Invalid idempotency header", 554)
  return {
    idempotencyKey,
    body: {
      from: mailbox(senders[0]),
      to,
      cc,
      bcc,
      reply_to: addresses(mail.replyTo).map(mailbox),
      subject: mail.subject ?? "",
      ...(mail.html === false ? {} : { html: mail.html }),
      ...(mail.text === undefined ? {} : { text: mail.text }),
      headers,
      attachments: mail.attachments.map((attachment) => ({
        filename: attachment.filename ?? "attachment",
        content: attachment.content.toString("base64"),
        content_type: attachment.contentType,
        ...(attachment.contentId
          ? { content_id: attachment.contentId.replace(/^<|>$/g, "") }
          : {}),
      })),
    },
  }
}

export function createSmtpServer({
  convexSiteUrl,
  key,
  cert,
  name,
  secure = false,
  maxMessageBytes = MAX_MESSAGE_BYTES,
}) {
  if (!key || !cert)
    throw new Error("SMTP TLS key and certificate are required")
  const base = new URL(convexSiteUrl)
  // HTTP is intended only for the private Compose network or local development.
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error("Invalid Convex site URL")
  if (
    !Number.isInteger(maxMessageBytes) ||
    maxMessageBytes < 1 ||
    maxMessageBytes > MAX_MESSAGE_BYTES
  )
    throw new Error("Invalid SMTP message size limit")
  const tokens = new Map()
  async function request(
    path,
    token,
    body,
    idempotencyKey,
    authenticating = false
  ) {
    const json = body === undefined ? undefined : JSON.stringify(body)
    if (json && Buffer.byteLength(json) > MAX_JSON_BYTES)
      throw smtpError("Message too large", 552)
    let response
    try {
      response = await fetch(new URL(path, base), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "Opensend SMTP",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: json,
      })
    } catch {
      throw smtpError("Submission service unavailable; retry later", 451)
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const temporary =
        response.status >= 500 ||
        response.status === 429 ||
        result.name === "concurrent_idempotent_requests"
      throw smtpError(
        temporary
          ? "Submission service busy; retry later"
          : authenticating
            ? "Authentication failed"
            : "Message rejected by submission service",
        temporary
          ? 451
          : authenticating
            ? 535
            : response.status === 413
              ? 552
              : 554
      )
    }
    if (authenticating && result.authenticated !== true)
      throw smtpError("Invalid authentication response; retry later", 451)
    if (!authenticating && typeof result.id !== "string")
      throw smtpError("Invalid submission response; retry later", 451)
    return result
  }
  return new SMTPServer({
    name,
    secure,
    key,
    cert,
    minVersion: "TLSv1.2",
    authMethods: ["PLAIN", "LOGIN"],
    authOptional: false,
    allowInsecureAuth: false,
    size: maxMessageBytes,
    maxClients: 16,
    socketTimeout: 60_000,
    closeTimeout: 10_000,
    disableReverseLookup: true,
    logger: false,
    onAuth(auth, session, callback) {
      if (!session.secure) return callback(smtpError("TLS is required", 538))
      if (
        auth.username !== "resend" ||
        !/^os_\S{1,512}$/.test(auth.password ?? "")
      )
        return callback(smtpError("Authentication failed", 535))
      request("/smtp/auth", auth.password, undefined, undefined, true).then(
        () => {
          tokens.set(session.id, auth.password)
          callback(null, { user: "resend" })
        },
        callback
      )
    },
    onRcptTo(address, session, callback) {
      callback(
        session.envelope.rcptTo.length >= 50
          ? smtpError("Too many recipients", 452)
          : null
      )
    },
    onData(stream, session, callback) {
      const token = session.secure && tokens.get(session.id)
      if (!token) {
        stream.resume()
        return callback(smtpError("Authentication required", 530))
      }
      // Drain excess DATA without retaining it, even if the client omits SIZE.
      const chunks = []
      let size = 0
      let finished = false
      const done = (error, message) => {
        if (!finished) {
          finished = true
          callback(error, message)
        }
      }
      stream.on("data", (chunk) => {
        size += chunk.length
        if (size <= maxMessageBytes) chunks.push(chunk)
      })
      stream.on("error", () => done(smtpError("Message transfer failed", 451)))
      stream.on("end", async () => {
        if (finished) return
        if (size > maxMessageBytes || stream.sizeExceeded)
          return done(smtpError("Message too large", 552))
        try {
          const { body, idempotencyKey } = await parseMessage(
            Buffer.concat(chunks),
            session.envelope.rcptTo.map(({ address }) => address)
          )
          const result = await request(
            "/smtp/emails",
            token,
            body,
            idempotencyKey
          )
          done(null, `Queued as ${result.id}`)
        } catch (error) {
          done(
            error.responseCode ? error : smtpError("Invalid email message", 554)
          )
        }
      })
    },
    onClose(session) {
      tokens.delete(session.id)
    },
  })
}
