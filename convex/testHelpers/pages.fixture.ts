import type { PageChannel } from "../../lib/channels"
import { api } from "../_generated/api"
import { metaFixture, META_APP, type GraphRoute } from "./meta.fixture"
export const PAGE_ID = "555000100"
export const IG_ID = "178414000001"
export const PSID = "10000001"
export const IGSID = "20000001"
export const PAGE_TOKEN = "EAAPageToken0123456789abcdef"
export const USER_TOKEN = "EAAUserToken0123456789abcdef"
export const PAGE_SCOPES = [
  "pages_messaging",
  "pages_manage_metadata",
  "pages_show_list",
  "instagram_basic",
  "instagram_manage_messages",
]
export const PAGE = {
  id: PAGE_ID,
  name: "Acme Page",
  access_token: PAGE_TOKEN,
  instagram_business_account: {
    id: IG_ID,
    username: "acme",
    name: "Acme Instagram",
  },
}
export const pageGraphRoutes = (): GraphRoute[] => [
  {
    path: "/oauth/access_token",
    respond: () => ({ access_token: USER_TOKEN }),
  },
  {
    path: "/debug_token",
    respond: () => ({
      data: { app_id: META_APP.appId, is_valid: true, scopes: PAGE_SCOPES },
    }),
  },
  { path: "/me/accounts", respond: () => ({ data: [PAGE] }) },
  { method: "GET", path: `/${PAGE_ID}`, respond: () => PAGE },
  { path: `/${PAGE_ID}/subscribed_apps`, respond: () => ({ success: true }) },
  {
    path: `/${PSID}`,
    respond: () => ({ first_name: "Ada", last_name: "Lovelace" }),
  },
  {
    path: `/${IGSID}`,
    respond: () => ({ name: "Grace Hopper", username: "grace" }),
  },
  {
    method: "POST",
    path: `/${PAGE_ID}/messages`,
    respond: () => ({ recipient_id: PSID, message_id: "mid.sent" }),
  },
]
export const pageEnvelope = (
  channel: PageChannel,
  fields: Record<string, unknown>,
  at = Date.now()
): {
  object: string
  entry: { id: string; messaging: Record<string, unknown>[] }[]
} => ({
  object: channel === "messenger" ? "page" : "instagram",
  entry: [
    {
      id: channel === "messenger" ? PAGE_ID : IG_ID,
      messaging: [
        {
          sender: { id: channel === "messenger" ? PSID : IGSID },
          recipient: { id: channel === "messenger" ? PAGE_ID : IG_ID },
          timestamp: at,
          ...fields,
        },
      ],
    },
  ],
})
export async function pagesFixture() {
  const f = await metaFixture()
  const connected = await f.owner.client.action(
    api.meta.pageConnectActions.connectPageManual,
    { organizationId: f.owner.team, pageId: PAGE_ID, token: PAGE_TOKEN }
  )
  return { ...f, accounts: connected.accounts }
}
