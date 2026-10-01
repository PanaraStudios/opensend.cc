import assert from "node:assert/strict"
import { test } from "node:test"
import { facebookLoginOptions } from "./facebook-login"
import { signupLoginOptions } from "./embedded-signup"
test("Facebook Login for Business requests the configured code grant without WhatsApp extras", () => {
  assert.deepEqual(facebookLoginOptions("page-config"), {
    config_id: "page-config",
    response_type: "code",
    override_default_response_type: true,
  })
  assert.deepEqual(signupLoginOptions("wa-config"), {
    ...facebookLoginOptions("wa-config"),
    extras: { setup: {} },
  })
})
