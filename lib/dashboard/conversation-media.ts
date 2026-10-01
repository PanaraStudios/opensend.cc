import type { ThreadMessage } from "../messages/use-messages"
import type { MediaViewerItem } from "../../components/ui/media-viewer"
import { array, object, string } from "../meta/parse"
import { safeMessageUrl } from "./conversation-content"

/** Gallery order follows the thread, including template headers/carousels. */
export function conversationMedia(
  messages: ThreadMessage[],
  sender: string
): MediaViewerItem[] {
  return messages.flatMap((message) => {
    const data = message.normalized
    if (!data || data.revoked_at || data.type === "revoke") return []
    const content = object(data.content)
    const metadata = {
      sender: message.direction === "outbound" ? "You" : sender,
      at: message.at,
      caption: string(content.caption),
    }
    const items: MediaViewerItem[] = []
    for (const [i, file] of data.attachments.entries()) {
      const type =
        data.type === "image" || data.type === "video"
          ? data.type
          : ["template", "interactive", "order"].includes(data.type)
            ? file.content_type?.startsWith("image/")
              ? "image"
              : file.content_type?.startsWith("video/")
                ? "video"
                : undefined
            : undefined
      const src = safeMessageUrl(file.download_url)
      if (type && src && !file.error)
        items.push({
          id: `${message.id}:${i}`,
          type,
          src,
          filename: file.filename ?? undefined,
          ...metadata,
        })
    }
    // Meta generic cards carry images in their content, rather than attachments.
    for (const [i, raw] of array(content.elements).entries()) {
      const card = object(raw)
      const src = safeMessageUrl(card.image_url)
      if (src)
        items.push({
          id: `${message.id}:card:${i}`,
          type: "image",
          src,
          ...metadata,
          caption: string(card.title) || string(card.subtitle),
        })
    }
    const referral = object(data.referral)
    const cardSrc = safeMessageUrl(content.image_url)
    if (cardSrc)
      items.push({
        id: `${message.id}:card`,
        type: "image",
        src: cardSrc,
        ...metadata,
        caption: string(content.title) || string(content.subtitle),
      })
    const src = safeMessageUrl(referral.image_url || referral.thumbnail_url)
    if (src)
      items.push({
        id: `${message.id}:referral`,
        type: "image",
        src,
        ...metadata,
        caption: string(referral.headline),
      })
    return items
  })
}
