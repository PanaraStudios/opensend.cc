import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

test("OAuth proxy routes HTTPS by upstream Host and preserves internal HTTP routing", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
// Compile the proxy without Next's server-only marker.
const source = readFileSync("./lib/oauth/proxy.ts", "utf8").replace('import "server-only"\\n', "")
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const { oauthProxy } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"))
for (const site of ["https://fake.eu.convex.site", "http://convex:3211"]) {
  process.env.CONVEX_INTERNAL_SITE_URL = site
  const request = new Request("https://mail.example.test/oauth/callback?code=test", {
    method: "POST",
    headers: { host: "mail.example.test", cookie: "session=test" },
    body: "state=test",
  })
  globalThis.fetch = async (url, init) => {
    assert.equal(url, site + "/oauth/callback?code=test")
    assert.equal(init.headers.get("host"), site.startsWith("https:") ? "fake.eu.convex.site" : "mail.example.test")
    assert.equal(init.headers.get("cookie"), "session=test")
    assert.equal(new TextDecoder().decode(init.body), "state=test")
    assert.equal(init.redirect, "manual")
    return new Response(null, { status: 302, headers: { location: "/emails" } })
  }
  const response = await oauthProxy(request)
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), "/emails")
  assert.equal(request.headers.get("host"), "mail.example.test")
}
`,
    ],
    { encoding: "utf8" }
  )
  assert.equal(result.status, 0, result.stderr)
})
