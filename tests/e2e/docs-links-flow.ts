import { expect, test, type Page } from "@playwright/test"

export function docsLinksTests(state: () => { owner: Page }) {
  test("Docs links open the current feature guide in a new tab", async () => {
    const { owner } = state()
    for (const [route, path, count] of [
      ["/emails", "/dashboard/emails/sending", 2],
      ["/emails/receiving", "/dashboard/receiving/introduction", 1],
      ["/emails/suppressions", "/dashboard/emails/suppressions", 1],
      ["/channels", "/self-hosting/requirements", 2],
      ["/properties", "/dashboard/audience/properties", 2],
      ["/api-keys", "/create-an-api-key", 2],
      ["/webhooks", "/webhooks/introduction", 2],
      ["/settings/smtp", "/self-hosting/smtp-gateway", 1],
      ["/settings/sso", "/dashboard/team/sso", 1],
      ["/instance/ses", "/self-hosting/aws-ses", 1],
      ["/instance/meta", "/self-hosting/requirements", 1],
      ["/instance/general", "/self-hosting/requirements", 1],
    ] as const) {
      await owner.goto(route)
      const links = owner.getByRole("link", { name: "Docs", exact: true })
      await expect(links).toHaveCount(count)
      for (const link of await links.all()) {
        await expect(link).toHaveAttribute(
          "href",
          `https://opensend.cc/docs${path}`
        )
        await expect(link).toHaveAttribute("target", "_blank")
        await expect(link).toHaveAttribute("rel", "noreferrer")
      }
    }
  })
}
