import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  PHONE_NUMBER_FIELDS,
  readPhoneNumber,
  readPhoneNumbers,
  readTokenInfo,
  registration,
  tokenBusinessId,
  tokenProblem,
} from "./whatsapp-account"

describe("readPhoneNumber", () => {
  it("reads a registered Cloud API number", () => {
    assert.deepEqual(
      readPhoneNumber({
        id: "106540352242922",
        display_phone_number: "+1 555-010-0000",
        verified_name: "Opensend",
        quality_rating: "GREEN",
        status: "CONNECTED",
        code_verification_status: "VERIFIED",
        platform_type: "CLOUD_API",
        throughput: { level: "HIGH" },
        whatsapp_business_manager_messaging_limit: "TIER_1K",
      }),
      {
        externalId: "106540352242922",
        displayName: "Opensend",
        handle: "+1 555-010-0000",
        status: "active",
        quality: "green",
        throughputMps: 1000,
        messagingLimit: "TIER_1K",
        registered: true,
      }
    )
  })

  it("waits for registration until Meta reports Cloud API", () => {
    const number = readPhoneNumber({
      id: "1",
      display_phone_number: "+1 555-010-0001",
      status: "PENDING",
      platform_type: "NOT_APPLICABLE",
      quality_rating: "NA",
      throughput: { level: "STANDARD" },
    })
    assert.equal(number?.status, "pending")
    assert.equal(number?.registered, false)
    assert.equal(number?.quality, "unknown")
    assert.equal(number?.throughputMps, 80)
    assert.equal(number?.displayName, "+1 555-010-0001")
    assert.equal(readPhoneNumber({ id: "1" })?.status, "pending")
  })

  it("keeps a recorded registration until Meta says otherwise", () => {
    const unknown = readPhoneNumber({ id: "1" })!
    assert.deepEqual(registration(unknown, 5, 9), {
      registeredAt: 5,
      status: "active",
    })
    assert.deepEqual(registration(unknown, undefined, 9), {
      registeredAt: undefined,
      status: "pending",
    })
    const cloud = readPhoneNumber({ id: "1", platform_type: "CLOUD_API" })!
    assert.deepEqual(registration(cloud, undefined, 9), {
      registeredAt: 9,
      status: "active",
    })
    const dropped = readPhoneNumber({
      id: "1",
      platform_type: "NOT_APPLICABLE",
    })!
    assert.deepEqual(registration(dropped, 5, 9), {
      registeredAt: undefined,
      status: "pending",
    })
    const flagged = readPhoneNumber({ id: "1", status: "FLAGGED" })!
    assert.equal(registration(flagged, 5, 9).status, "restricted")
  })

  it("maps restricted and failed numbers", () => {
    assert.equal(
      readPhoneNumber({
        id: "1",
        status: "FLAGGED",
        platform_type: "CLOUD_API",
      })?.status,
      "restricted"
    )
    assert.equal(
      readPhoneNumber({ id: "1", status: "BANNED" })?.status,
      "error"
    )
  })

  it("skips entries without a numeric id", () => {
    assert.equal(readPhoneNumber({ display_phone_number: "+1" }), null)
    assert.equal(readPhoneNumber({ id: "../me" }), null)
    assert.deepEqual(
      readPhoneNumbers({ data: [{ id: "7" }, null, { id: "x" }] }).map(
        (number) => number.externalId
      ),
      ["7"]
    )
    assert.deepEqual(readPhoneNumbers({}), [])
  })

  it("asks for the current messaging limit field", () => {
    assert.ok(
      PHONE_NUMBER_FIELDS.includes("whatsapp_business_manager_messaging_limit")
    )
    assert.ok(!PHONE_NUMBER_FIELDS.includes("messaging_limit_tier"))
  })
})

describe("business tokens", () => {
  const debug = (data: Record<string, unknown>) =>
    readTokenInfo({
      data: {
        app_id: "123",
        is_valid: true,
        scopes: [
          "whatsapp_business_management",
          "whatsapp_business_messaging",
          "business_management",
        ],
        ...data,
      },
    })
  const expected = { appId: "123", wabaId: "555" }

  it("accepts a token for the app that reaches the WABA", () => {
    const info = debug({
      granular_scopes: [
        { scope: "whatsapp_business_management", target_ids: ["555"] },
        { scope: "whatsapp_business_messaging", target_ids: [555] },
        { scope: "business_management", target_ids: ["777"] },
      ],
    })
    assert.equal(tokenProblem(info, expected), null)
    assert.equal(tokenBusinessId(info), "777")
    // Scopes without targets cover every asset.
    assert.equal(tokenProblem(debug({}), expected), null)
    assert.equal(tokenBusinessId(debug({})), undefined)
  })

  it("names what is wrong with a token", () => {
    assert.match(
      tokenProblem(
        debug({ is_valid: false, error: { message: "Session expired" } }),
        expected
      )!,
      /not valid: Session expired/
    )
    assert.match(
      tokenProblem(debug({ app_id: "999" }), expected)!,
      /different Meta app/
    )
    assert.match(
      tokenProblem(
        debug({ scopes: ["whatsapp_business_management"] }),
        expected
      )!,
      /missing the whatsapp_business_messaging permission$/
    )
    assert.match(
      tokenProblem(
        debug({
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: ["1"] },
          ],
        }),
        expected
      )!,
      /no access to this WhatsApp Business Account/
    )
  })
})
