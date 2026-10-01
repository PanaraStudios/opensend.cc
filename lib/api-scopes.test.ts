import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  API_RESOURCES,
  API_SCOPES,
  parseScopes,
  scopeAllows,
  scopeLabel,
} from "./api-scopes"
import { parseScopes as parseOAuthScopes, oauthScopes } from "./oauth/policy"

describe("API scopes", () => {
  it("has one catalog of grantable resources, excluding keys and team settings", () => {
    assert.equal(API_RESOURCES.length, 16)
    assert.equal(new Set(API_SCOPES).size, 32)
    assert.deepEqual(
      [...new Set(API_RESOURCES.map((r) => r.group))],
      ["Messaging", "Audience", "Content", "Setup"]
    )
    for (const scope of API_SCOPES) assert.ok(oauthScopes[scope])
  })
  it("write implies read only on the same resource", () => {
    assert.equal(scopeAllows(["whatsapp:write"], "whatsapp", "read"), true)
    assert.equal(scopeAllows(["contacts:read"], "contacts", "write"), false)
    assert.equal(scopeAllows(["whatsapp:write"], "contacts", "read"), false)
    assert.equal(scopeAllows([], "emails", "write"), false)
  })
  it("normalizes duplicate and implied scopes", () => {
    assert.deepEqual(
      parseScopes([
        "contacts:read",
        "whatsapp:write",
        "whatsapp:read",
        "contacts:read",
      ]),
      ["whatsapp:write", "contacts:read"]
    )
    assert.deepEqual(parseScopes([]), [])
    assert.equal(scopeLabel("contacts:write"), "Contacts: Read and write")
  })
  it("rejects malformed scopes and ungrantable resources", () => {
    for (const value of [
      undefined,
      null,
      "contacts:read",
      [1],
      ["contacts:send"],
      ["keys:write"],
      ["full_access"],
      ["emails:send"],
    ])
      assert.throws(() => parseScopes(value))
  })
  it("OAuth supports catalog scopes while preserving legacy scopes", () => {
    assert.deepEqual(
      parseOAuthScopes("emails:send contacts:read whatsapp:write"),
      ["emails:send", "contacts:read", "whatsapp:write"]
    )
    assert.deepEqual(parseOAuthScopes("full_access"), ["full_access"])
    assert.throws(() => parseOAuthScopes("keys:write"))
  })
})
