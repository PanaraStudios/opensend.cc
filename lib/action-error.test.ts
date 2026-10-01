import assert from "node:assert/strict"
import { it } from "node:test"
import { actionError } from "./action-error"

it("shows structured API refusals and preserves plain Convex errors", () => {
  assert.equal(
    actionError({
      data: {
        name: "email_not_configured",
        message: "Email sending is not set up on this instance",
      },
    }),
    "Email sending is not set up on this instance"
  )
  assert.equal(actionError({ data: "Sign in again" }), "Sign in again")
  assert.equal(actionError(new Error("Try again")), "Try again")
  assert.equal(actionError(null), "Please try again")
})
