import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_GRAPH_VERSION, graphUrl } from "./graph-url"

describe("graphUrl", () => {
  it("builds a versioned Graph URL with its query", () => {
    assert.equal(
      graphUrl({
        version: DEFAULT_GRAPH_VERSION,
        path: "/1234/subscriptions",
        query: { fields: "id,name", limit: 5, skipped: undefined },
      }).href,
      "https://graph.facebook.com/v25.0/1234/subscriptions?fields=id%2Cname&limit=5"
    )
  })
  it("uses a local origin override", () => {
    assert.equal(
      graphUrl({
        version: "v24.0",
        path: "1234",
        origin: "http://host.docker.internal:4010",
      }).href,
      "http://host.docker.internal:4010/v24.0/1234"
    )
  })
  it("rejects invalid versions and paths", () => {
    for (const version of ["25.0", "v25", "v25.0/..", ""])
      assert.throws(() => graphUrl({ version, path: "me" }), /version/)
    for (const path of ["", "/", "../me", "a/./b"])
      assert.throws(() => graphUrl({ version: "v25.0", path }), /path/)
  })
})
