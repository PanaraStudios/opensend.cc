import assert from "node:assert/strict"
import { test } from "node:test"
import {
  trackingHtml,
  TRACKING_CONTEXT,
  MAX_TRACKED_LINKS,
} from "../tracking/html"
import { readToken, signToken } from "../tokens/signed"
import {
  signUnsubscribeToken,
  readUnsubscribeToken,
} from "../unsubscribe/token"

const secret = "test-tracking-secret-".repeat(3)
const options = {
  emailId: "email1",
  origin: "https://api.example.com",
  open: true,
  click: true,
  secret,
  unsubscribeUrls: ["https://example.com/leave?x=1&y=2"],
}

test("rewrites HTML links while preserving quotes, attributes, encoding and nonlinks", async () => {
  const html = `<body><a class='cta' HREF = 'https://example.com/?x=1&amp;y=%22' data-x=ok>Go &amp; see</a><area href=https://example.com/map><img src="https://example.com/logo.png"><!-- <a href="https://example.com/comment"> --><script>const a='<a href="https://example.com/script">'</script></body>`
  const result = await trackingHtml({ ...options, html })
  assert.deepEqual(result.links, [
    "https://example.com/?x=1&y=%22",
    "https://example.com/map",
  ])
  assert.match(
    result.html,
    /class='cta' HREF = 'https:\/\/api.example.com\/t\/c\/[^']+' data-x=ok>Go &amp; see/
  )
  assert.ok(result.html.includes('<img src="https://example.com/logo.png">'))
  assert.ok(
    result.html.includes('<!-- <a href="https://example.com/comment"> -->')
  )
  assert.match(result.html, /width="1" height="1" alt="" \/><\/body>$/)
  const tokens = [...result.html.matchAll(/\/t\/c\/([A-Za-z0-9_.-]+)/g)]
  assert.equal(
    await readToken(tokens[0][1], TRACKING_CONTEXT, secret),
    "email1.0"
  )
  assert.equal(
    await readToken(tokens[1][1], TRACKING_CONTEXT, secret),
    "email1.1"
  )
})

test("skips unsubscribe URLs, opt-outs, fragments, mailto and unsafe protocols", async () => {
  const html = `<a href="mailto:hi@example.com">email</a><a href="#top">top</a><a href="javascript:alert(1)">js</a><a href="https://user:pass@example.com">credentials</a><a href="https://api.example.com/unsubscribe/token">unsub</a><a href="https://example.com/leave?x=1&amp;y=2">leave</a><a ses:no-track href="https://example.com">skip</a><a href="https://example.com" rel="unsubscribe">leave</a>`
  const result = await trackingHtml({ ...options, open: false, html })
  assert.equal(result.html, html)
  assert.deepEqual(result.links, [])
})

test("tracking toggles are independent", async () => {
  const html = '<a href="https://example.com">Hi</a>'
  assert.equal(
    (await trackingHtml({ ...options, open: false, click: false, html })).html,
    html
  )
  const open = await trackingHtml({ ...options, click: false, html })
  assert.deepEqual(open.links, [])
  assert.ok(open.html.startsWith(html))
  const click = await trackingHtml({ ...options, open: false, html })
  assert.ok(!click.html.includes("/t/o/"))
})

test("shared HMAC signer preserves unsubscribe tokens and separates purposes", async () => {
  const target = { organizationId: "team", contactId: "contact" }
  const token = await signUnsubscribeToken(target, secret)
  assert.deepEqual(await readUnsubscribeToken(token, secret), target)
  assert.equal(await readToken(token, TRACKING_CONTEXT, secret), null)
  const tracking = await signToken("email.0", TRACKING_CONTEXT, secret)
  assert.equal(
    await readToken(tracking, TRACKING_CONTEXT, "different-secret".repeat(3)),
    null
  )
  assert.equal(await readToken(tracking + "x", TRACKING_CONTEXT, secret), null)
})

test("link storage is capped by count and bytes", async () => {
  await assert.rejects(
    trackingHtml({
      ...options,
      html: '<a href="https://example.com">x</a>'.repeat(MAX_TRACKED_LINKS + 1),
    }),
    /limit/
  )
  await assert.rejects(
    trackingHtml({
      ...options,
      html: `<a href="https://example.com/${"x".repeat(129 * 1024)}">x</a>`,
    }),
    /limit/
  )
})

test("body-end text in comments and scripts cannot swallow the open pixel", async () => {
  const html =
    '<body><!-- </body> --><script>const a="</body>"</script><p>Hello</p></body>'
  const result = await trackingHtml({ ...options, html })
  assert.ok(result.html.startsWith(html.slice(0, -7)))
  assert.match(
    result.html,
    /<p>Hello<\/p><img src="https:\/\/api.example.com\/t\/o\/[^\"]+" width="1" height="1" alt="" \/><\/body>$/
  )
})
