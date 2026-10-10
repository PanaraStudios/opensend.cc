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
    assert.equal(API_RESOURCES.length, 21)
    assert.equal(new Set(API_SCOPES).size, 42)
    assert.deepEqual(
      [...new Set(API_RESOURCES.map((r) => r.group))],
      ["Messaging", "Audience", "Content & campaigns", "Setup", "Calling"]
    )
    assert.ok(API_RESOURCES.some((resource) => resource.id === "ivrs"))
    assert.ok(API_RESOURCES.some((resource) => resource.id === "voice_bots"))
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

it("groups call setup in order and retains existing broad grants without granting messaging to Calling", () => {
  assert.deepEqual(
    API_RESOURCES.filter((r) => r.group === "Calling").map((r) => r.id),
    [
      "knowledge",
      "bot_tools",
      "calling",
      "ivrs",
      "voice_bots",
      "voice_providers",
    ]
  )
  assert.equal(scopeAllows(["whatsapp:write"], "calling", "write"), true)
  assert.equal(scopeAllows(["calling:write"], "whatsapp", "write"), false)
  assert.equal(
    scopeAllows(["voice_bots:read"], "voice_providers", "read"),
    true
  )
  assert.equal(
    scopeAllows(["voice_providers:write"], "voice_bots", "write"),
    false
  )
})
