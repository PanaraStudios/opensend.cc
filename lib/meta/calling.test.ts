import { test } from "node:test"
import assert from "node:assert/strict"
import {
  callOptions,
  validateCallingSettings,
  validateSdp,
  callWireStatus,
  buildCallingSettingsPayload,
  writableCallingSettings,
} from "./calling"
import { verifyGatewayHmac } from "./calling-gateway"
import { signRequest } from "../../services/call-gateway/src/auth"
test("calling payload validation keeps opt-ins separate and replaces hours whole", () => {
  assert.deepEqual(
    callOptions({
      recording: { status: "DISABLED" },
      transcription: {
        status: "ENABLED",
        purpose: "Support",
        announcement_language: "en",
      },
    }),
    {
      recording: { status: "DISABLED" },
      transcription: {
        status: "ENABLED",
        purpose: "Support",
        announcement_language: "en",
      },
    }
  )
  assert.throws(
    () => callOptions({ recording: { status: "ENABLED" } }),
    /purpose/
  )
  assert.throws(
    () => callOptions({ biz_opaque_callback_data: "x".repeat(513) }),
    /512/
  )
  assert.throws(
    () => validateCallingSettings({ sip: { status: "ENABLED" } }),
    /SIP/
  )
  assert.throws(
    () =>
      validateCallingSettings({
        call_hours: {
          status: "ENABLED",
          timezone_id: "wrong",
          weekly_operating_hours: [],
        },
      }),
    /timezone/
  )
  const settings = {
    call_hours: {
      status: "ENABLED",
      timezone_id: "UTC",
      weekly_operating_hours: [
        { day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
      ],
    },
  }
  assert.deepEqual(validateCallingSettings(settings), settings)
  assert.equal(callWireStatus(["completed"]), "COMPLETED")
  assert.throws(() => validateSdp("v=0\nm=audio"), /CRLF/)
})

test("a default dashboard form switched on produces only the minimal Meta body", () => {
  const input = {
    status: "ENABLED",
    call_icon_visibility: "DEFAULT",
    audio: { additional_codecs: [] },
    call_icons: { restrict_to_user_countries: [] },
    call_hours: {
      status: "DISABLED",
      timezone_id: "UTC",
      weekly_operating_hours: [],
      holiday_schedule: [],
    },
    voicemail: {
      status: "DISABLED",
      triggers: [],
      audio: { default: { timeout_seconds: 20 } },
    },
  }
  const original = structuredClone(input)
  const minimal = {
    calling: { status: "ENABLED", call_icon_visibility: "DEFAULT" },
  }
  assert.deepEqual(buildCallingSettingsPayload(input), minimal)
  assert.deepEqual(buildCallingSettingsPayload({ status: "ENABLED" }), minimal)
  assert.deepEqual(input, original)
  assert.deepEqual(buildCallingSettingsPayload({}), { calling: {} })
  assert.deepEqual(
    buildCallingSettingsPayload(
      { status: "ENABLED" },
      { call_icon_visibility: "DISABLE_ALL" }
    ),
    { calling: { status: "ENABLED", call_icon_visibility: "DISABLE_ALL" } }
  )
})

test("settings payload includes configured countries, codecs and only valid callback enums", () => {
  const input = {
    call_icon_visibility: "DISABLE_ALL",
    call_icons: { restrict_to_user_countries: ["US", "BR"], read_only: true },
    audio: { additional_codecs: ["PCMA", "PCMU"], read_only: true },
    callback_permission_status: "ENABLED",
  }
  assert.deepEqual(buildCallingSettingsPayload(input), {
    calling: {
      call_icon_visibility: "DISABLE_ALL",
      call_icons: { restrict_to_user_countries: ["US", "BR"] },
      audio: { additional_codecs: ["PCMA", "PCMU"] },
      callback_permission_status: "ENABLED",
    },
  })
  assert.deepEqual(
    buildCallingSettingsPayload({ callback_permission_status: "DISABLED" }),
    { calling: { callback_permission_status: "DISABLED" } }
  )
  for (const value of [
    true,
    false,
    "",
    "DEFAULT",
    ["ENABLED"],
    { status: "ENABLED" },
  ]) {
    assert.throws(
      () => buildCallingSettingsPayload({ callback_permission_status: value }),
      /ENABLED or DISABLED/
    )
    assert.deepEqual(
      writableCallingSettings({
        status: "ENABLED",
        callback_permission_status: value,
      }),
      { status: "ENABLED" }
    )
  }
  for (const value of ["ENABLED", "DISABLED"])
    assert.deepEqual(
      writableCallingSettings({ callback_permission_status: value }),
      { callback_permission_status: value }
    )
  assert.deepEqual(
    buildCallingSettingsPayload({ audio: null, voicemail: undefined }),
    { calling: {} }
  )
  assert.deepEqual(
    buildCallingSettingsPayload({
      call_icons: {},
      audio: {},
      call_hours: {},
      voicemail: {},
    }),
    { calling: {} }
  )
})

test("settings payload replaces hours whole and omits empty holiday schedules", () => {
  const weekly = [
    { day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
  ]
  const holiday = { date: "2099-12-25", start_time: "0000", end_time: "2359" }
  const hours = {
    status: "ENABLED",
    timezone_id: "UTC",
    weekly_operating_hours: weekly,
    holiday_schedule: [holiday],
  }
  assert.deepEqual(buildCallingSettingsPayload({ call_hours: hours }), {
    calling: { call_hours: hours },
  })
  const noHolidays = {
    status: "ENABLED",
    timezone_id: "UTC",
    weekly_operating_hours: weekly,
  }
  assert.deepEqual(
    buildCallingSettingsPayload(
      { call_hours: { ...noHolidays, holiday_schedule: [] } },
      { call_hours: hours }
    ),
    { calling: { call_hours: noHolidays } }
  )
  assert.deepEqual(
    buildCallingSettingsPayload(
      { call_hours: { status: "DISABLED" } },
      { call_hours: hours }
    ),
    { calling: { call_hours: { ...noHolidays, status: "DISABLED" } } }
  )
  assert.throws(
    () =>
      buildCallingSettingsPayload({
        call_hours: { ...noHolidays, weekly_operating_hours: [] },
      }),
    /weekly_operating_hours/
  )
  assert.throws(
    () => buildCallingSettingsPayload({ call_hours: hours }, {}, "2100-01-01"),
    /holiday schedule/
  )
})

test("settings payload includes enabled voicemail and can disable an existing announcement", () => {
  const voicemail = {
    status: "ENABLED",
    triggers: ["REJECT", "TIMEOUT"],
    audio: {
      default: {
        announcement_media_id: "938884519013664",
        timeout_seconds: 20,
      },
    },
  }
  assert.deepEqual(buildCallingSettingsPayload({ voicemail }), {
    calling: { voicemail },
  })
  assert.deepEqual(
    buildCallingSettingsPayload(
      { voicemail: { status: "DISABLED" } },
      { voicemail }
    ),
    { calling: { voicemail: { status: "DISABLED" } } }
  )
  const rejectOnly = {
    ...voicemail,
    triggers: ["REJECT"],
    audio: { default: { announcement_media_id: 938884519013664 } },
  }
  assert.deepEqual(buildCallingSettingsPayload({ voicemail: rejectOnly }), {
    calling: { voicemail: rejectOnly },
  })
  assert.throws(
    () =>
      buildCallingSettingsPayload({
        voicemail: { ...voicemail, triggers: [] },
      }),
    /triggers/
  )
  assert.throws(
    () =>
      buildCallingSettingsPayload({
        voicemail: {
          ...voicemail,
          audio: {
            default: { announcement_media_id: "1", timeout_seconds: 1.5 },
          },
        },
      }),
    /timeout_seconds/
  )
})

test("settings payload resets only configured SIP/SDES for this Graph-only app", () => {
  assert.deepEqual(
    buildCallingSettingsPayload(
      { status: "ENABLED" },
      { sip: { status: "DISABLED" }, srtp_key_exchange_protocol: "DTLS" }
    ),
    { calling: { status: "ENABLED", call_icon_visibility: "DEFAULT" } }
  )
  assert.deepEqual(
    buildCallingSettingsPayload(
      { status: "ENABLED" },
      {
        sip: {
          status: "ENABLED",
          servers: [{ hostname: "sip.example.com", port: 5061 }],
        },
        srtp_key_exchange_protocol: "SDES",
      }
    ),
    {
      calling: {
        status: "ENABLED",
        call_icon_visibility: "DEFAULT",
        sip: { status: "DISABLED" },
        srtp_key_exchange_protocol: "DTLS",
      },
    }
  )
  assert.throws(
    () => buildCallingSettingsPayload({ sip: { status: "ENABLED" } }),
    /SIP/
  )
})
test("callback HMAC matches gateway client bytes and binds body/path/method/timestamp", async () => {
  const secret = "a".repeat(64),
    path = "/calling/gateway/events",
    body = '{"event":"media_up"}',
    bytes = new TextEncoder().encode(body),
    now = Date.now()
  const headers = signRequest(
    secret,
    "POST",
    path,
    body,
    Math.floor(now / 1000).toString()
  )
  const request = new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers,
    body,
  })
  assert.ok(await verifyGatewayHmac(secret, request, bytes, now))
  assert.equal(
    await verifyGatewayHmac(
      secret,
      request,
      new TextEncoder().encode(body + " "),
      now
    ),
    null
  )
  assert.equal(
    await verifyGatewayHmac(secret, request, bytes, now + 61000),
    null
  )
  assert.equal(
    await verifyGatewayHmac(
      secret,
      new Request("https://api.example.test/wrong", {
        method: "POST",
        headers,
        body,
      }),
      bytes,
      now
    ),
    null
  )
  assert.equal(
    await verifyGatewayHmac(
      secret,
      new Request(`https://api.example.test${path}?x=1`, {
        method: "POST",
        headers,
        body,
      }),
      bytes,
      now
    ),
    null
  )
})
