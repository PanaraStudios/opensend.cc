import assert from "node:assert/strict"
import { describe, it, test } from "node:test"
import {
  MetaError,
  classifyGraphError,
  parseGraphError,
  parseGraphResponse,
} from "./errors"

const classify = (code?: number, status = 400, isTransient = false) =>
  classifyGraphError({ status, code, isTransient })

describe("classifyGraphError", () => {
  it("retries throttling, outages and transient errors", () => {
    for (const code of [1, 2, 4, 80007, 130429, 131000])
      assert.equal(classify(code), "retry", String(code))
    assert.equal(classify(undefined, 503), "retry")
    assert.equal(classify(12345, 400, true), "retry")
  })
  it("waits longer after too many messages to one person", () => {
    assert.equal(classify(131056), "retry_after")
  })
  it("gives up on window, delivery, opt-out, template, parameter and policy errors", () => {
    for (const code of [
      131047, 131026, 131050, 132000, 132015, 132999, 100, 368,
    ])
      assert.equal(classify(code), "final", String(code))
    // A known final code stays final even on a 5xx or a transient flag.
    assert.equal(classify(131047, 500, true), "final")
    assert.equal(classify(133000), "final")
    assert.equal(classify(undefined, 404), "final")
  })
  it("flags an invalid token", () => {
    assert.equal(classify(190, 401), "token_invalid")
    assert.equal(classify(190, 500, true), "token_invalid")
  })
})

describe("parseGraphError", () => {
  it("reads Graph's error object", () => {
    assert.deepEqual(
      parseGraphError(
        400,
        JSON.stringify({
          error: {
            message: "(#131047) Re-engagement message",
            type: "OAuthException",
            code: 131047,
            error_subcode: 2494010,
            is_transient: false,
            fbtrace_id: "Az8or2yhqkZfEZ-_4Qn_Bam",
          },
        })
      ),
      {
        status: 400,
        code: 131047,
        subcode: 2494010,
        isTransient: false,
        message: "(#131047) Re-engagement message",
        fbtraceId: "Az8or2yhqkZfEZ-_4Qn_Bam",
      }
    )
  })
  it("still yields an error for a body that is not Graph's", () => {
    assert.deepEqual(parseGraphError(502, "<html>Bad gateway</html>"), {
      status: 502,
      code: undefined,
      subcode: undefined,
      isTransient: false,
      message: "Meta returned HTTP 502",
      fbtraceId: undefined,
    })
  })
})

describe("parseGraphResponse", () => {
  it("returns the JSON of a successful call", () => {
    assert.deepEqual(parseGraphResponse(200, '{"id":"1","name":"App"}'), {
      id: "1",
      name: "App",
    })
    assert.deepEqual(parseGraphResponse(204, ""), {})
  })
  it("throws a classified MetaError for an error status or body", () => {
    assert.throws(
      () =>
        parseGraphResponse(
          401,
          '{"error":{"message":"Invalid OAuth access token","code":190}}'
        ),
      (error: unknown) =>
        error instanceof MetaError &&
        error.status === 401 &&
        error.code === 190 &&
        error.action === "token_invalid" &&
        error.message === "Invalid OAuth access token"
    )
    assert.throws(
      () => parseGraphResponse(200, '{"error":{"message":"Oops","code":2}}'),
      (error: unknown) => error instanceof MetaError && error.action === "retry"
    )
    assert.throws(() => parseGraphResponse(200, "not json"), MetaError)
  })
})

test("Graph user-facing error titles survive parsing and MetaError construction", () => {
  const body = JSON.stringify({
    error: {
      code: 131047,
      message: "Window closed",
      error_user_title: "Re-engagement required",
    },
  })
  const info = parseGraphError(400, body)
  assert.equal(info.title, "Re-engagement required")
  assert.equal(new MetaError(info).title, "Re-engagement required")
})
