import { expect, test, type Page } from "@playwright/test"
import { createHash, randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../../convex/_generated/api"
export async function selectOAuthTeam(page: Page, teamId: string) {
  await page.getByRole("combobox", { name: "Team", exact: true }).click()
  await page.getByTestId(`oauth-team-${teamId}`).click()
}
export async function beginOAuth(page: Page) {
  const response = await page.request.post(
    `${process.env.OPENSEND_BASE_URL}/oauth/register`,
    {
      data: {
        client_name: "Continuation example",
        redirect_uris: ["https://example-client.test/callback"],
        scope: "full_access",
      },
    }
  )
  expect(response.status()).toBe(201)
  const app = await response.json()
  const verifier = randomBytes(32).toString("base64url")
  await page.goto(
    `${process.env.OPENSEND_BASE_URL}/oauth/authorize?` +
      new URLSearchParams({
        client_id: app.client_id,
        redirect_uri: "https://example-client.test/callback",
        response_type: "code",
        scope: "full_access",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })
  )
}
export async function oauthFlow(page: Page, teamId: string) {
  const base = process.env.OPENSEND_BASE_URL ?? "http://localhost:3400"
  for (const method of ["none", "client_secret_basic", "client_secret_post"]) {
    const callback =
      method === "none"
        ? "http://127.0.0.1:9876/callback"
        : "https://example-client.test/callback"
    await page.route(`${callback}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<p>Example client callback</p>",
      })
    )
    const registration = await page.request.post(`${base}/oauth/register`, {
      data: {
        client_name: `Example ${method}`,
        redirect_uris: [callback],
        scope: "full_access",
        token_endpoint_auth_method: method,
      },
    })
    expect(registration.status(), await registration.text()).toBe(201)
    const app = await registration.json()
    const verifier = randomBytes(32).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const state = randomBytes(16).toString("hex")
    const params = new URLSearchParams({
      client_id: app.client_id,
      redirect_uri: callback,
      response_type: "code",
      scope: "full_access",
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
    })
    await page.goto(`${base}/oauth/authorize?${params}`)
    await expect(
      page.getByRole("heading", { name: `Connect Example ${method}` })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Authorize", exact: true })
    ).toBeDisabled()
    if (method === "none") {
      for (const colorScheme of ["light", "dark"] as const)
        for (const width of [1440, 390]) {
          await page.emulateMedia({ colorScheme })
          await page.setViewportSize({ width, height: 1000 })
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
          ).toBe(width)
          await page.screenshot({
            path: test.info().outputPath(`consent-${colorScheme}-${width}.png`),
            fullPage: true,
          })
        }
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.emulateMedia({ colorScheme: "light" })
    }
    await selectOAuthTeam(page, teamId)
    await page.getByRole("button", { name: "Authorize", exact: true }).click()
    await page.waitForURL(`${callback}**`)
    const result = new URL(page.url())
    expect(result.searchParams.get("state")).toBe(state)
    const code = result.searchParams.get("code")
    expect(code).toBeTruthy()
    const credentials: Record<string, string> =
      method === "client_secret_post"
        ? { client_id: app.client_id, client_secret: app.client_secret }
        : { client_id: app.client_id }
    const headers: Record<string, string> =
      method === "client_secret_basic"
        ? {
            Authorization: `Basic ${Buffer.from(`${app.client_id}:${app.client_secret}`).toString("base64")}`,
          }
        : {}
    const exchange = await page.request.post(`${base}/oauth/token`, {
      headers,
      form: {
        ...credentials,
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: callback,
        code_verifier: verifier,
      },
    })
    expect(exchange.status(), await exchange.text()).toBe(200)
    const tokens = await exchange.json()
    expect(tokens.expires_in).toBe(900)
    expect(tokens.scope).toBe("full_access")
    expect(tokens.refresh_token).toBeTruthy()
    if (method === "none") {
      await page.goto(`${base}/profile`)
      await expect(
        page.getByRole("cell", { name: "Example none", exact: true })
      ).toBeVisible()
      for (const colorScheme of ["light", "dark"] as const)
        for (const width of [1440, 390]) {
          await page.emulateMedia({ colorScheme })
          await page.setViewportSize({ width, height: 1000 })
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
          ).toBe(width)
          await page.screenshot({
            path: test.info().outputPath(`profile-${colorScheme}-${width}.png`),
            fullPage: true,
          })
        }
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.emulateMedia({ colorScheme: "light" })
      await page.goto(`${base}/settings/team`)
      await page
        .getByRole("tab", { name: "Authorized apps", exact: true })
        .click()
      await expect(
        page.getByRole("cell", { name: "Example none", exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Invite", exact: true })
      ).toHaveCount(0)
    }
    const grants = await page.request.get(`${base}/oauth/grants`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    expect(grants.status(), await grants.text()).toBe(200)
    const rows = await grants.json()
    expect(
      rows.some((g: { organizationId: string }) => g.organizationId === teamId)
    ).toBe(true)
    const introspect = await page.request.post(`${base}/oauth/introspect`, {
      headers,
      form: { ...credentials, token: tokens.access_token },
    })
    expect((await introspect.json()).active).toBe(true)
    const dashboard = new ConvexHttpClient(
      process.env.OPENSEND_CONVEX_URL ?? "http://localhost:3410"
    )
    dashboard.setAuth(tokens.access_token)
    await expect(dashboard.query(api.teams.snapshot)).rejects.toBeTruthy()
    const direct = await page.request.post(`${base}/api/auth/oauth2/token`, {
      form: {
        ...credentials,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      },
    })
    expect(direct.ok()).toBe(false)
    if (method === "none") {
      execFileSync(
        "docker",
        [
          "compose",
          "--env-file",
          process.env.OPENSEND_ENV_FILE!,
          "-p",
          process.env.COMPOSE_PROJECT_NAME!,
          "restart",
          "convex",
        ],
        { stdio: "pipe" }
      )
      await expect
        .poll(
          async () => {
            try {
              return (
                await page.request.get(`${base}/oauth/grants`, {
                  headers: { Authorization: `Bearer ${tokens.access_token}` },
                })
              ).status()
            } catch {
              return 0
            }
          },
          { timeout: 30000 }
        )
        .toBe(200)
      await page.request.post(`${base}/api/auth/sign-out`, {
        headers: { Origin: base },
        data: {},
      })
    }
    const refreshed = await page.request.post(`${base}/oauth/token`, {
      headers,
      form: {
        ...credentials,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      },
    })
    expect(refreshed.status(), await refreshed.text()).toBe(200)
    const next = await refreshed.json()
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    if (method === "client_secret_basic") {
      const grant = rows.find(
        (g: { application: string }) => g.application === `Example ${method}`
      )
      expect(
        (
          await page.request.delete(`${base}/oauth/grants/${grant.id}`, {
            headers: { Authorization: `Bearer ${next.access_token}` },
          })
        ).status()
      ).toBe(200)
    }
    if (method === "client_secret_post") {
      await page.goto(`${base}/settings/team`)
      await page
        .getByRole("tab", { name: "Authorized apps", exact: true })
        .click()
      const row = page.getByRole("row").filter({
        has: page.getByRole("cell", {
          name: `Example ${method}`,
          exact: true,
        }),
      })
      await row.getByRole("button").click()
      await page.getByRole("menuitem", { name: "Revoke access" }).click()
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Revoke access", exact: true })
        .click()
      await expect(row).toHaveCount(0)
      await page.goto(`${base}/profile`)
      await expect(row).toHaveCount(0)
      expect(
        (
          await page.request.post(`${base}/oauth/revoke`, {
            headers,
            form: { ...credentials, token: next.refresh_token },
          })
        ).status()
      ).toBe(200)
    }
    const replay = await page.request.post(`${base}/oauth/token`, {
      headers,
      form: {
        ...credentials,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      },
    })
    expect(replay.ok()).toBe(false)
    expect(
      (
        await page.request.get(`${base}/oauth/grants`, {
          headers: { Authorization: `Bearer ${next.access_token}` },
        })
      ).ok()
    ).toBe(false)
    if (method === "none") {
      await page.goto(`${base}/login`)
      await page.getByLabel("Email", { exact: true }).fill("owner@example.test")
      await page
        .getByLabel("Password", { exact: true })
        .fill("Playwright-owner-password-123")
      await page.getByRole("button", { name: "Sign in", exact: true }).click()
      await expect(page).toHaveURL(/\/emails/)
    }
  }
  // A send-only client cannot escalate its grant, and a wrong PKCE verifier fails.
  const securityRegistration = await page.request.post(
    `${base}/oauth/register`,
    {
      data: {
        client_name: "Security example",
        redirect_uris: ["https://example-client.test/callback"],
        scope: "emails:send full_access",
      },
    }
  )
  expect(securityRegistration.status()).toBe(201)
  const security = await securityRegistration.json()
  for (const wrongVerifier of [true, false]) {
    const verifier = randomBytes(32).toString("base64url")
    await page.goto(
      `${base}/oauth/authorize?` +
        new URLSearchParams({
          client_id: security.client_id,
          redirect_uri: "https://example-client.test/callback",
          response_type: "code",
          scope: "emails:send",
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
        })
    )
    await selectOAuthTeam(page, teamId)
    await page.getByRole("button", { name: "Authorize", exact: true }).click()
    await page.waitForURL("https://example-client.test/callback**")
    const code = new URL(page.url()).searchParams.get("code")!
    const exchanged = await page.request.post(`${base}/oauth/token`, {
      form: {
        client_id: security.client_id,
        grant_type: "authorization_code",
        code,
        code_verifier: wrongVerifier ? "x".repeat(43) : verifier,
        redirect_uri: "https://example-client.test/callback",
      },
    })
    if (wrongVerifier) {
      expect(exchanged.ok()).toBe(false)
      continue
    }
    expect(exchanged.status(), await exchanged.text()).toBe(200)
    const tokens = await exchanged.json()
    expect(
      (
        await page.request.get(`${base}/oauth/grants`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).status()
    ).toBe(403)
    const escalation = await page.request.post(`${base}/oauth/token`, {
      form: {
        client_id: security.client_id,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: "full_access",
      },
    })
    expect(escalation.ok()).toBe(false)
    expect(
      (
        await page.request.post(`${base}/oauth/revoke`, {
          form: { client_id: security.client_id, token: tokens.refresh_token },
        })
      ).status()
    ).toBe(200)
    expect(
      (
        await (
          await page.request.post(`${base}/oauth/introspect`, {
            form: { client_id: security.client_id, token: tokens.access_token },
          })
        ).json()
      ).active
    ).toBe(false)
  }
  const nativeCallback = "com.example.opensend:/callback"
  const nativeRegistration = await page.request.post(`${base}/oauth/register`, {
    data: {
      client_name: "Native example",
      redirect_uris: [nativeCallback],
      scope: "emails:send",
    },
  })
  expect(nativeRegistration.status()).toBe(201)
  const native = await nativeRegistration.json()
  const nativeVerifier = randomBytes(32).toString("base64url")
  const nativeStart = await page.request.get(
    `${base}/oauth/authorize?` +
      new URLSearchParams({
        client_id: native.client_id,
        redirect_uri: nativeCallback,
        response_type: "code",
        scope: "emails:send",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(nativeVerifier)
          .digest("base64url"),
      }),
    { maxRedirects: 0 }
  )
  const nativeFlow = new URL(nativeStart.headers().location).searchParams.get(
    "flow"
  )!
  const nativeApproval = await page.request.post(
    `${base}/oauth/flow?flow=${nativeFlow}`,
    {
      headers: { Origin: base },
      data: { accept: true, organizationId: teamId },
    }
  )
  expect(nativeApproval.status(), await nativeApproval.text()).toBe(200)
  const nativeCode = new URL(
    (await nativeApproval.json()).url
  ).searchParams.get("code")!
  const nativeTokens = await page.request.post(`${base}/oauth/token`, {
    form: {
      client_id: native.client_id,
      grant_type: "authorization_code",
      redirect_uri: nativeCallback,
      code: nativeCode,
      code_verifier: nativeVerifier,
    },
  })
  expect(nativeTokens.status(), await nativeTokens.text()).toBe(200)
  const nativeToken = (await nativeTokens.json()).refresh_token
  expect(
    (
      await page.request.post(`${base}/oauth/revoke`, {
        form: { client_id: native.client_id, token: nativeToken },
      })
    ).status()
  ).toBe(200)
  const bad = await page.request.post(`${base}/oauth/register`, {
    data: {
      client_name: "Bad",
      redirect_uris: ["javascript:alert(1)"],
      scope: "full_access",
    },
  })
  expect(bad.status()).toBe(400)
  const missingScope = await page.request.post(`${base}/oauth/register`, {
    data: {
      client_name: "Bad",
      redirect_uris: ["https://example.test/callback"],
    },
  })
  expect(missingScope.status()).toBe(400)
  await page.goto(`${base}/oauth/consent?flow=${"f".repeat(64)}`)
  await expect(
    page.getByRole("heading", { name: "Authorization unavailable" })
  ).toBeVisible()
  await page.goto(`${base}/profile`)
}
