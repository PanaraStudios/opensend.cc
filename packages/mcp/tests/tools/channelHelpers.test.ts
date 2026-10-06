import { describe, expect, it } from "vitest"
import {
  channelOutput,
  channelPageCheck,
} from "../../src/tools/channelMessaging.js"

describe("channel pages", () => {
  it("allows one cursor and refuses both", () => {
    expect(() => channelPageCheck({})).not.toThrow()
    expect(() => channelPageCheck({ after: "next" })).not.toThrow()
    expect(() => channelPageCheck({ before: "prev" })).not.toThrow()
    expect(() => channelPageCheck({ after: "", before: "" })).not.toThrow()
    expect(() => channelPageCheck({ after: "next", before: "prev" })).toThrow(
      "Cannot use both after and before."
    )
  })

  it("returns object data as structured content and throws provider errors", () => {
    expect(channelOutput("WhatsApp", { data: { id: "message" }, error: null })).toEqual(
      {
        structuredContent: { id: "message" },
        content: [{ type: "text", text: JSON.stringify({ id: "message" }, null, 2) }],
      }
    )
    expect(
      channelOutput("WhatsApp", { data: [{ id: "message" }], error: null })
    ).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ id: "message" }], null, 2),
        },
      ],
    })
    expect(channelOutput("WhatsApp", { data: null, error: null })).toEqual({
      content: [{ type: "text", text: "null" }],
    })
    expect(() =>
      channelOutput("WhatsApp", {
        data: null,
        error: { name: "validation_error", message: "Missing `to`." },
      })
    ).toThrow(
      'WhatsApp request failed: {"name":"validation_error","message":"Missing `to`."}'
    )
  })
})
