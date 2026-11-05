import assert from "node:assert/strict"
import { test } from "node:test"
import { facebookLoginOptions } from "./facebook-login"
import { signupLoginOptions } from "./embedded-signup"
test("Facebook Login for Business lets the configuration pick the response; Embedded Signup forces the code grant", () => {
  assert.deepEqual(facebookLoginOptions("page-config"), {
    config_id: "page-config",
  })
  assert.deepEqual(signupLoginOptions("wa-config"), {
    config_id: "wa-config",
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {} },
  })
})
