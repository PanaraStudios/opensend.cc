// Add --manual to run each OAuth operation from the terminal.
// Tokens stay in memory and are never printed or written to disk.
import { createServer } from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { createInterface } from "node:readline"

const base = (process.env.OPENSEND_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
)
const manual = process.argv.includes("--manual")
const scope = process.env.OPENSEND_SCOPE || "full_access"
let verifier, state, code, tokens, previousRefresh
let receiving = false
const server = createServer()
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const callback = `http://127.0.0.1:${server.address().port}/callback`

async function request(path, body, { method, accessToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status}: ${data.error_description || data.error || "Request failed"}`
    )
  return data
}

let client
try {
  client = await request("/oauth/register", {
    client_name: manual ? "Manual OAuth test" : "Local example",
    redirect_uris: [callback],
    scope,
    token_endpoint_auth_method: "none",
  })
} catch (error) {
  server.close()
  console.error(`Registration failed: ${error.message}`)
  process.exitCode = 1
}

function authorize() {
  verifier = randomBytes(32).toString("base64url")
  state = randomBytes(32).toString("hex")
  code = undefined
  const authorization = new URL(`${base}/oauth/authorize`)
  authorization.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: "code",
    scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString()
  console.log(`\nOpen this URL to authorize:\n${authorization}`)
}
async function exchange() {
  if (!code)
    throw new Error("Open the authorization URL and approve the app first.")
  const receivedCode = code
  code = undefined // Codes are single-use, including failed exchange attempts.
  tokens = await request("/oauth/token", {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code: receivedCode,
    code_verifier: verifier,
    redirect_uri: callback,
  })
  previousRefresh = undefined
  console.log(
    `Tokens received. Access lasts ${tokens.expires_in} seconds. Granted scope: ${tokens.scope}.`
  )
}
function requireTokens() {
  if (!tokens) throw new Error("Run exchange first.")
}
async function refresh() {
  requireTokens()
  const next = await request("/oauth/token", {
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: tokens.refresh_token,
  })
  previousRefresh = tokens.refresh_token
  tokens = next
  console.log(
    "Refresh succeeded. The refresh token rotated; the app stays connected."
  )
}
async function revoke() {
  requireTokens()
  await request("/oauth/revoke", {
    client_id: client.client_id,
    token: tokens.refresh_token,
  })
  console.log(
    "Access revoked. The app should disappear from Profile → OAuth apps."
  )
}
async function grants() {
  requireTokens()
  return request("/oauth/grants", undefined, {
    accessToken: tokens.access_token,
  })
}

server.on("request", async (req, res) => {
  const url = new URL(req.url, callback)
  if (
    req.method !== "GET" ||
    url.pathname !== "/callback" ||
    url.searchParams.get("state") !== state ||
    !url.searchParams.get("code") ||
    receiving
  ) {
    res.writeHead(400).end("Invalid or already handled callback")
    return
  }
  receiving = true
  code = url.searchParams.get("code")
  state = undefined
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  try {
    if (manual) {
      res.end(
        "Authorization received. Return to the terminal and run exchange within two minutes. Open Opensend Profile → OAuth apps in another tab to inspect the connection. Access remains connected until you revoke it."
      )
      console.log(
        "\nAuthorization received. Run exchange within two minutes. Your app is now visible in Profile → OAuth apps."
      )
      terminal?.prompt()
    } else {
      await exchange()
      console.log(
        `Connected: ${(await grants()).length} authorization(s) visible`
      )
      await refresh()
      await revoke()
      res.end(
        "Example completed: authorized, called the grant API, refreshed, and disconnected."
      )
      server.close()
    }
  } catch (error) {
    res.writeHead(400).end("Example failed. See terminal.")
    console.error(error.message)
    if (!manual) server.close()
  } finally {
    receiving = false
  }
})

function help() {
  console.log(`
Commands (type one and press Enter):
  exchange        Exchange the received code for tokens (within two minutes).
  grants          Call GET /oauth/grants and display the result.
  introspect      Check whether the access token is active.
  inspect-refresh Check whether the refresh token is active.
  refresh         Rotate the refresh token; keep the app connected.
  revoke          Revoke access through POST /oauth/revoke.
  revoke-grant    Revoke this grant through DELETE /oauth/grants/:id.
  replay-refresh  Reuse the old refresh token after refresh (revokes the grant).
  authorize       Print a fresh authorization URL for this registered client.
  discovery       Display OAuth server metadata.
  keys            Display public signing keys.
  help            Show this list.
  quit            Exit; leaves the app connected for UI revocation.

To test UI revocation, use Profile → OAuth apps → ⋯ → Revoke access.
Then run introspect (active: false), grants (rejected), or refresh (rejected).
Registration alone does not appear in the UI; authorization creates the row.
`)
}
let terminal
if (client) {
  console.log(`Application registered: ${client.client_name}. Scope: ${scope}.`)
  authorize()
  if (manual) {
    help()
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "oauth> ",
    })
    terminal.prompt()
    for await (const line of terminal) {
      try {
        switch (line.trim().toLowerCase()) {
          case "exchange":
            await exchange()
            break
          case "grants":
            console.table(await grants())
            break
          case "introspect":
          case "inspect-refresh": {
            requireTokens()
            const token =
              line.trim().toLowerCase() === "introspect"
                ? tokens.access_token
                : tokens.refresh_token
            console.log(
              await request("/oauth/introspect", {
                client_id: client.client_id,
                token,
              })
            )
            break
          }
          case "refresh":
            await refresh()
            break
          case "revoke":
            await revoke()
            break
          case "revoke-grant": {
            requireTokens()
            const info = await request("/oauth/introspect", {
              client_id: client.client_id,
              token: tokens.access_token,
            })
            if (!info.active || !info.grant_id)
              throw new Error("No active grant to revoke.")
            await request(
              `/oauth/grants/${encodeURIComponent(info.grant_id)}`,
              undefined,
              { method: "DELETE", accessToken: tokens.access_token }
            )
            console.log("Grant revoked. Check the OAuth apps card.")
            break
          }
          case "replay-refresh":
            if (!previousRefresh)
              throw new Error(
                "Run refresh first to create an old refresh token."
              )
            await request("/oauth/token", {
              grant_type: "refresh_token",
              client_id: client.client_id,
              refresh_token: previousRefresh,
            })
            throw new Error("Unexpected: replay was accepted.")
          case "authorize":
            authorize()
            break
          case "discovery":
            console.log(
              await request("/.well-known/oauth-authorization-server/oauth")
            )
            break
          case "keys":
            console.log(await request("/oauth/jwks"))
            break
          case "help":
            help()
            break
          case "quit":
            terminal.close()
            break
          case "":
            break
          default:
            console.log("Unknown command. Type help.")
        }
      } catch (error) {
        console.error(error.message)
      }
      if (line.trim().toLowerCase() === "quit") break
      terminal.prompt()
    }
    console.log(
      "Example stopped. Any active authorization remains in Opensend until you revoke it."
    )
    server.close()
  } else {
    setTimeout(() => {
      server.close()
      process.exit(0)
    }, 600000).unref()
  }
}
