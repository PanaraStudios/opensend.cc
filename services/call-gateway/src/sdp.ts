import { isIP } from "node:net"
import { GatewayError } from "./errors.js"

export interface SdpRules {
  side: "meta" | "gateway"
  type: "offer" | "answer"
}
const fail = (message: string): never => {
  throw new GatewayError("INVALID_SDP", message)
}
const records = (sdp: string) => {
  if (sdp.length > 65536 || /[^\x09\x0a\x0d\x20-\x7e]/.test(sdp))
    fail("Invalid SDP encoding or size")
  const lines = sdp.split(/\r?\n/).filter(Boolean)
  if (
    lines[0] !== "v=0" ||
    !lines.some((l) => l.startsWith("o=")) ||
    !lines.some((l) => l.startsWith("t="))
  )
    fail("Missing SDP session fields")
  if (lines.filter((l) => l.startsWith("m=")).length !== 1)
    fail("Exactly one audio m-line is required")
  const m = lines.find((l) => l.startsWith("m="))!.split(/\s+/)
  if (
    m[0] !== "m=audio" ||
    !/^\d+$/.test(m[1]) ||
    Number(m[1]) < 1 ||
    Number(m[1]) > 65535 ||
    !["UDP/TLS/RTP/SAVPF", "RTP/SAVPF"].includes(m[2])
  )
    fail("Audio DTLS-SRTP is required")
  if (
    !m.slice(3).length ||
    m.slice(3).some((pt) => !/^\d+$/.test(pt) || Number(pt) > 127)
  )
    fail("Invalid RTP payload types")
  return lines
}

/** Restrict codec capability without inventing candidates, keys, fingerprints or SSRCs. */
export function opusOnly(sdp: string): string {
  const lines = records(sdp)
  const opus = lines.filter((l) => /^a=rtpmap:\d+ opus\/48000\/2$/i.test(l))
  if (opus.length !== 1) fail("Exactly one Opus/48000/2 payload is required")
  const pt = opus[0].match(/^a=rtpmap:(\d+)/)![1]
  // telephone-event is a DTMF format, not another speech codec.
  const dtmf = lines.find((l) =>
    /^a=rtpmap:\d+ telephone-event\/8000$/i.test(l)
  )
  const dtmfPt = dtmf?.match(/^a=rtpmap:(\d+)/)?.[1]
  const m = lines.find((l) => l.startsWith("m="))!.split(/\s+/)
  if (!m.slice(3).includes(pt)) fail("Opus payload is absent from m-line")
  if (lines.some((l) => l.startsWith("a=ptime:") && l !== "a=ptime:20"))
    fail("Opus ptime must be 20 ms")
  const allowed = [
    pt,
    ...(dtmfPt && m.slice(3).includes(dtmfPt) ? [dtmfPt] : []),
  ]
  const filtered = lines
    .filter((l) => {
      const payload = l.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)\b/)
      return !payload || allowed.includes(payload[1])
    })
    .map((l) =>
      l.startsWith("m=") ? [...m.slice(0, 3), ...allowed].join(" ") : l
    )
    .filter(
      (l) =>
        !l.startsWith("a=ice-options:") &&
        !l.startsWith("a=ptime:") &&
        !l.startsWith("a=maxptime:")
    )
  // Disable Opus DTX: the business must keep sending even during silence.
  const fmtpIndex = filtered.findIndex((l) => l.startsWith(`a=fmtp:${pt} `))
  if (fmtpIndex >= 0)
    filtered[fmtpIndex] = filtered[fmtpIndex].replace(
      /\busedtx=1\b/g,
      "usedtx=0"
    )
  filtered.push("a=ptime:20", "a=maxptime:20")
  return `${filtered.join("\r\n")}\r\n`
}

export function validateSdp(sdp: string, rules: SdpRules): void {
  const lines = records(sdp)
  if (!sdp.endsWith("\r\n") || sdp.replaceAll("\r\n", "").includes("\n"))
    fail("SDP must use CRLF records")
  const m = lines.find((l) => l.startsWith("m="))!.split(/\s+/)
  const payloads = lines.filter((l) => l.startsWith("a=rtpmap:"))
  if (
    m.slice(3).length < 1 ||
    m.slice(3).length > 2 ||
    payloads.length !== m.slice(3).length ||
    payloads.filter((l) => /^a=rtpmap:\d+ opus\/48000\/2$/i.test(l)).length !==
      1 ||
    payloads.some(
      (l) => !/^a=rtpmap:\d+ (opus\/48000\/2|telephone-event\/8000)$/i.test(l)
    ) ||
    payloads.some((l) => !m.slice(3).includes(l.split(/[ :]/)[1]))
  )
    fail("Only Opus/48000/2 and optional DTMF/8000 are supported")
  if (!lines.includes("a=ptime:20")) fail("ptime must be 20 ms")
  if (lines.some((l) => /^a=ice-options:.*\btrickle\b/.test(l)))
    fail("Trickle ICE is unsupported")
  // RFC 8839 ice-chars plus "=": Meta's live offers use base64 padding in
  // ice-pwd (e.g. "+219v9nKr3xSQIn8s+Fy8g=="), and libnice accepts it.
  for (const field of ["ice-ufrag", "ice-pwd"]) {
    if (
      !lines.some((l) =>
        new RegExp(
          `^a=${field}:[A-Za-z0-9+/=]{${field === "ice-ufrag" ? "4,256" : "22,256"}}$`
        ).test(l)
      )
    )
      fail(`Missing valid ${field}`)
  }
  const fingerprints = lines.filter((l) => l.startsWith("a=fingerprint:"))
  if (
    fingerprints.length !== 1 ||
    !/^a=fingerprint:sha-256 (?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i.test(
      fingerprints[0]
    )
  )
    fail("A SHA-256 DTLS fingerprint is required")
  if (!lines.includes("a=rtcp-mux")) fail("RTCP mux is required")
  const candidates = lines.filter((l) => l.startsWith("a=candidate:"))
  if (!candidates.length) fail("Complete ICE candidates are required")
  for (const candidate of candidates) {
    const fields = candidate.slice(12).split(/\s+/)
    if (
      !/^[a-zA-Z0-9+/]+$/.test(fields[0]) ||
      !["1", "2"].includes(fields[1]) ||
      fields[2].toLowerCase() !== "udp" ||
      !/^\d+$/.test(fields[3]) ||
      Number(fields[3]) > 4294967295 ||
      !isIP(fields[4]) ||
      !/^\d+$/.test(fields[5]) ||
      Number(fields[5]) < 1 ||
      Number(fields[5]) > 65535 ||
      fields[6] !== "typ" ||
      !["host", "srflx", "prflx", "relay"].includes(fields[7])
    )
      fail("Invalid UDP ICE candidate")
  }
  if (!candidates.some((l) => l.split(/\s+/)[1] === "1"))
    fail("An RTP ICE candidate is required")
  const ssrcs = new Set(
    lines.filter((l) => l.startsWith("a=ssrc:")).map((l) => l.split(/[ :]/)[1])
  )
  if (ssrcs.size > 1 || lines.some((l) => l.startsWith("a=ssrc-group:")))
    fail("At most one audio SSRC is supported")
  const setup = lines.filter((l) => l.startsWith("a=setup:"))
  const expected =
    rules.side === "gateway"
      ? rules.type === "answer"
        ? ["a=setup:active"]
        : ["a=setup:actpass", "a=setup:active"]
      : rules.type === "answer"
        ? ["a=setup:passive"]
        : ["a=setup:actpass", "a=setup:passive"]
  if (setup.length !== 1 || !expected.includes(setup[0]))
    fail("Gateway must act as the DTLS client")
  if (rules.side === "gateway") {
    if (lines.includes("a=ice-lite")) fail("Gateway must be ICE-full")
    if (!lines.includes("a=end-of-candidates"))
      fail("ICE gathering must finish before publication")
  } else if (!lines.includes("a=ice-lite"))
    fail("Meta peer must advertise ICE-lite (gateway is controlling)")
}

export function metaSdp(sdp: string, type: "offer" | "answer"): string {
  const normalized = opusOnly(sdp)
  validateSdp(normalized, { side: "meta", type })
  return normalized
}

/** Call ONLY with a Janus JSEP event emitted after candidate gathering completes. */
export function gatewaySdp(sdp: string, type: "offer" | "answer"): string {
  let normalized = opusOnly(sdp)
  if (!normalized.includes("a=end-of-candidates\r\n"))
    normalized += "a=end-of-candidates\r\n"
  validateSdp(normalized, { side: "gateway", type })
  return normalized
}

/** ICE role is a runtime property, not an SDP attribute. */
export function validateIceRuntime(info: Record<string, unknown>): void {
  if (info["ice-mode"] !== "full" || info["ice-role"] !== "controlling")
    throw new GatewayError(
      "ICE_ROLE",
      "Janus must use ICE-full controlling mode",
      502
    )
}
