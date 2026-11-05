import assert from "node:assert/strict"
import { it } from "node:test"
import { loginErrorMessage, SSO_SIGNUP_REQUIRED } from "./auth-errors"

it("explains an SSO sign-in that needs a password account first", () => {
  assert.match(
    loginErrorMessage(SSO_SIGNUP_REQUIRED)!,
    /Create your account with email and password/
  )
  assert.equal(
    loginErrorMessage("oidc"),
    "The link or sign-in attempt failed. Please try again."
  )
  assert.equal(loginErrorMessage(null), null)
})
