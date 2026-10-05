// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest"
import * as net from "../lib/net/public-fetch"
import { graph } from "./meta/graph"
import { MetaError, metaErrorReason } from "../lib/meta/errors"

afterEach(() => vi.restoreAllMocks())

test("Graph errors redact credentials in query and form fields and app-token components", async () => {
  const appSecret = "fixture app credential"
  const businessToken = "fixture business credential"
  const code = "fixture exchange value"
  const verifyToken = "fixture subscription value"
  const echoed = [appSecret, businessToken, code, verifyToken]
    .flatMap((value) => [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ value }).toString().slice(6),
    ])
    .join(" / ")
  vi.spyOn(net, "publicFetch").mockResolvedValue(
    Response.json(
      {
        error: {
          message: echoed,
          error_user_title: echoed,
          error_user_msg: echoed,
          error_data: { details: echoed },
          fbtrace_id: echoed,
          code: 100,
        },
      },
      { status: 400 }
    )
  )
  try {
    await graph({
      token: `123|${appSecret}`,
      method: "POST",
      path: "subscriptions",
      version: "v25.0",
      query: { client_secret: appSecret, input_token: businessToken, code },
      body: { form: { verify_token: verifyToken } },
    })
    throw new Error("Expected a Meta error")
  } catch (error) {
    expect(error).toBeInstanceOf(MetaError)
    const shown =
      metaErrorReason(error as MetaError) + (error as MetaError).fbtraceId
    for (const value of [appSecret, businessToken, code, verifyToken]) {
      expect(shown).not.toContain(value)
      expect(shown).not.toContain(encodeURIComponent(value))
      expect(shown).not.toContain(
        new URLSearchParams({ value }).toString().slice(6)
      )
    }
  }
})
