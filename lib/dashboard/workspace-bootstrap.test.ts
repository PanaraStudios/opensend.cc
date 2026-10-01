import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react"
import { WorkspaceDataProvider } from "../../components/auth/workspace"
import { workspaceInstallation } from "./workspace-bootstrap"

test("a parallel installation error waits for the account during session revocation", () => {
  const revoked = new Error("Sign in again")
  assert.equal(workspaceInstallation(true, undefined, revoked), undefined)
  assert.equal(workspaceInstallation(true, null, revoked), undefined)
  assert.equal(
    workspaceInstallation(false, { user: "old" }, revoked),
    undefined
  )
})

test("valid accounts keep live installation updates and real failures", () => {
  const account = { user: "current" }
  const setup = { completedAt: undefined }
  const completed = { completedAt: 1 }
  assert.equal(workspaceInstallation(true, account, undefined), undefined)
  assert.equal(workspaceInstallation(true, account, setup), setup)
  assert.equal(workspaceInstallation(true, account, completed), completed)
  const failure = new Error("Database failure")
  assert.throws(() => workspaceInstallation(true, account, failure), failure)
})

test("sign-out cannot expose a cached installation from the previous user", () => {
  assert.equal(
    workspaceInstallation(false, { user: "old" }, { admin: true }),
    undefined
  )
  assert.equal(workspaceInstallation(true, null, { admin: true }), undefined)
})

// The real Convex hook updates state during rendering if given a fresh query map.
// Render the provider itself so this regression cannot hide behind helper tests.
test("workspace subscriptions render public routes without a rerender loop", async () => {
  const client = new ConvexReactClient("http://127.0.0.1:3156")
  try {
    const html = renderToStaticMarkup(
      createElement(
        ConvexProviderWithAuth,
        {
          client,
          useAuth: () => ({
            isAuthenticated: false,
            isLoading: false,
            fetchAccessToken: async () => null,
          }),
        },
        createElement(
          WorkspaceDataProvider,
          null,
          createElement("p", null, "Public route")
        )
      )
    )
    assert.match(html, /Public route/)
  } finally {
    await client.close()
  }
})
