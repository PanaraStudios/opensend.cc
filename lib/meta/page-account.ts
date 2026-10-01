import { object, string, array } from "./parse"
import type { TokenInfo } from "./whatsapp-account"

export { PAGE_CHANNELS, type PageChannel } from "../channels"
export const PAGE_FIELDS =
  "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}"
export const PAGE_WEBHOOK_FIELDS = [
  "messages",
  "message_deliveries",
  "message_reads",
  "messaging_postbacks",
  "message_echoes",
] as const
export const INSTAGRAM_WEBHOOK_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_reactions",
  "messaging_seen",
] as const
export type Page = {
  id: string
  name: string
  token?: string
  instagram?: { id: string; username: string; name: string }
}
export function readPage(raw: unknown): Page | null {
  const data = object(raw),
    id = string(data.id)
  if (!/^\d{1,32}$/.test(id) || !string(data.name)) return null
  const ig = object(data.instagram_business_account)
  return {
    id,
    name: string(data.name),
    ...(string(data.access_token) ? { token: string(data.access_token) } : {}),
    ...(/^\d{1,32}$/.test(string(ig.id))
      ? {
          instagram: {
            id: string(ig.id),
            username: string(ig.username) || string(ig.id),
            name: string(ig.name) || string(ig.username) || string(ig.id),
          },
        }
      : {}),
  }
}
export const readPages = (raw: unknown) =>
  array(object(raw).data).flatMap((row) => readPage(row) ?? [])

/** Facebook Login's Page permissions differ from WhatsApp's token scopes. */
export function pageTokenProblem(
  info: TokenInfo,
  appId: string,
  pageId?: string,
  instagram = false
): string | null {
  if (!info.valid) return "Meta says the token is not valid"
  if (info.appId !== appId) return "The token belongs to a different Meta app"
  const scopes = [
    "pages_messaging",
    "pages_manage_metadata",
    ...(instagram ? ["instagram_basic", "instagram_manage_messages"] : []),
  ]
  const missing = scopes.filter((scope) => !info.scopes.includes(scope))
  if (missing.length)
    return `The token is missing the ${missing.join(" and ")} permission${missing.length > 1 ? "s" : ""}`
  for (const scope of ["pages_messaging", "pages_manage_metadata"]) {
    const targets = info.targets[scope]
    if (pageId && targets && !targets.includes(pageId))
      return "The token has no access to this Facebook Page"
  }
  return null
}
