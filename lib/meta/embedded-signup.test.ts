import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isFacebookOrigin,
  readSignupMessage,
  signupLoginOptions,
} from "./embedded-signup"

describe("Embedded Signup", () => {
  it("asks FB.login for a token code with the v4 setup extras", () => {
    assert.deepEqual(signupLoginOptions("111"), {
      config_id: "111",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {} },
    })
  })

  it("trusts only Facebook's HTTPS origins", () => {
    for (const origin of [
      "https://www.facebook.com",
      "https://web.facebook.com",
      "https://facebook.com",
    ])
      assert.ok(isFacebookOrigin(origin), origin)
    for (const origin of [
      "http://www.facebook.com",
      "https://evilfacebook.com",
      "https://facebook.com.example",
      "null",
    ])
      assert.ok(!isFacebookOrigin(origin), origin)
  })

  it("reads FINISH, FINISH_ONLY_WABA, CANCEL and errors", () => {
    const finish = {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { phone_number_id: "1", waba_id: "2", business_id: "3" },
    }
    assert.deepEqual(readSignupMessage(JSON.stringify(finish)), {
      type: "finish",
      wabaId: "2",
      businessId: "3",
      phoneNumberId: "1",
    })
    assert.deepEqual(
      readSignupMessage({
        ...finish,
        event: "FINISH_ONLY_WABA",
        data: { waba_id: "2", business_id: "3" },
      }),
      { type: "finish", wabaId: "2", businessId: "3", phoneNumberId: undefined }
    )
    assert.deepEqual(
      readSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { current_step: "PHONE_NUMBER_SETUP" },
      }),
      { type: "cancel", step: "PHONE_NUMBER_SETUP" }
    )
    assert.deepEqual(
      readSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { error_message: "Business is restricted", error_code: "1" },
      }),
      { type: "error", message: "Business is restricted" }
    )
    assert.deepEqual(
      readSignupMessage({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR" }),
      { type: "error", message: "Meta could not finish signup" }
    )
  })

  it("ignores other messages", () => {
    assert.equal(readSignupMessage("not json"), null)
    assert.equal(readSignupMessage({ type: "OTHER", event: "FINISH" }), null)
    assert.equal(
      readSignupMessage({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "2" },
      }),
      null
    )
    assert.equal(readSignupMessage(null), null)
  })
})
