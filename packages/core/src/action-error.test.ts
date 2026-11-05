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

it("never shows Convex's request wrapper", () => {
  const failure =
    "Something went wrong on our side. Please try again; if it keeps happening, share the reference with your administrator. (Reference: 306c2bcee3d045fa)"
  assert.equal(
    actionError(
      new Error(
        "[CONVEX A(calling/softphone:requestPermission)] [Request ID: 306c2bcee3d045fa] Server Error\n  Called by client"
      )
    ),
    failure
  )
  assert.equal(
    actionError(
      new Error(
        "[CONVEX M(domains:update)] [Request ID: 306c2bcee3d045fa] Server Error\nUncaught Error: Domain not found\n    at handler (convex/domains.ts:10:3)\n  Called by client"
      )
    ),
    failure
  )
  assert.equal(
    actionError(new Error("Uncaught Error: Domain not found")),
    "Domain not found"
  )
  assert.equal(
    actionError(new TypeError("Failed to fetch")),
    "Can't reach the server. Check your connection and try again."
  )
})
