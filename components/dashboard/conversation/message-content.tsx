"use client"
import { UserIcon, ExternalLinkIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { object, array, string } from "@/lib/meta/parse"
import { safeMessageUrl } from "@/lib/dashboard/conversation-content"
import type { ThreadMessage } from "@/lib/messages/use-messages"
import { AttachedButtons, BusinessCard, LocationCard } from "./business-card"
import { ConversationMedia } from "./media"
import { FormattedText } from "./formatted-text"

export function NormalizedMessageContent({
  message,
}: {
  message: ThreadMessage
}) {
  const data = message.normalized
  const content = object(data?.content)
  const type = data?.type
  if (type === "revoke" || data?.revoked_at)
    return <em className="opacity-70">This message was deleted</em>
  if (["image", "video", "audio", "document", "sticker"].includes(type ?? ""))
    return (
      <div className="flex flex-col gap-1">
        {(data?.attachments.length ? data.attachments : [undefined]).map(
          (file, i) => (
            <ConversationMedia
              key={i}
              file={file}
              viewerId={`${message.id}:${i}`}
              type={type!}
              voice={
                content.voice === true ||
                /opus/i.test(string(content.mime_type))
              }
              pages={
                typeof content.pages === "number" ? content.pages : undefined
              }
            />
          )
        )}
        {content.caption ? (
          <FormattedText text={string(content.caption)} />
        ) : null}
      </div>
    )
  if (type === "location") return <LocationCard location={content} />
  if (type === "contacts")
    return (
      <div className="flex flex-col gap-3">
        {array(data?.content).map((raw, i) => {
          const contact = object(raw)
          const phones = array(contact.phones)
          const emails = array(contact.emails)
          return (
            <div key={i} className="w-64 max-w-full">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>
                    <UserIcon className="size-5" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">
                    {string(object(contact.name).formatted_name) || "Contact"}
                  </p>
                  {phones.map((phone, j) => (
                    <p key={j} className="text-xs opacity-70">
                      {string(object(phone).phone)}
                    </p>
                  ))}
                  {emails.map((email, j) => (
                    <p key={j} className="text-xs opacity-70">
                      {string(object(email).email)}
                    </p>
                  ))}
                </div>
              </div>
              <AttachedButtons
                buttons={[
                  { type: "QUICK_REPLY", text: "Message" },
                  { type: "QUICK_REPLY", text: "Add contact" },
                ]}
              />
            </div>
          )
        })}
      </div>
    )
  if (type === "button")
    return <FormattedText text={string(content.text) || message.text} />
  if (type === "interactive") {
    const subtype = string(content.type)
    if (subtype === "button_reply" || subtype === "list_reply") {
      const reply = object(content[subtype])
      return (
        <div>
          <p>
            <FormattedText text={string(reply.title)} />
          </p>
          {reply.description ? (
            <p className="text-xs opacity-70">{string(reply.description)}</p>
          ) : null}
        </div>
      )
    }
    if (subtype === "nfm_reply") {
      const reply = object(content.nfm_reply)
      return (
        <div>
          <p className="font-medium">
            {string(reply.name) === "address_message"
              ? "Address received"
              : "Form response"}
          </p>
          {reply.body ? <p>{string(reply.body)}</p> : null}
          {Object.entries(object(content.response)).map(([key, value]) => (
            <p key={key} className="text-xs">
              <span className="opacity-70">{key.replaceAll("_", " ")}: </span>
              {typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
                ? String(value)
                : "Response received"}
            </p>
          ))}
        </div>
      )
    }
    if (subtype === "call_permission_reply")
      return (
        <p>
          Call permission:{" "}
          {string(object(content.call_permission_reply).response)}
        </p>
      )
    return <BusinessCard message={message} />
  }
  if (type === "template") return <BusinessCard message={message} />
  if (type === "order")
    return (
      <BusinessCard
        message={message}
        content={{
          ...content,
          body: { text: string(content.text) || "Cart received" },
        }}
      />
    )
  if (type === "edit")
    return (
      <div>
        <em className="text-xs opacity-70">Edited message</em>
        <p>
          <FormattedText
            text={string(object(content.text).body) || message.text}
          />
        </p>
      </div>
    )
  return (
    <div>
      <FormattedText text={string(content.body) || message.text} />
      {array(data?.quick_replies).length ? (
        <AttachedButtons
          buttons={array(data?.quick_replies).map((reply) => ({
            type: "QUICK_REPLY",
            text: string(object(reply).title),
          }))}
        />
      ) : null}
    </div>
  )
}
export function ReferralCard({ message }: { message: ThreadMessage }) {
  const referral = object(message.normalized?.referral)
  if (!Object.keys(referral).length) return null
  const src = safeMessageUrl(referral.thumbnail_url || referral.image_url)
  const href = safeMessageUrl(referral.source_url)
  return (
    <div className="mb-2 flex w-72 max-w-full flex-col gap-2">
      {src ? (
        <ConversationMedia
          url={src}
          type="image"
          viewerId={`${message.id}:referral`}
          label={string(referral.headline) || "Ad"}
        />
      ) : null}{" "}
      <div className="p-2">
        <span className="text-xs opacity-70">
          {referral.source_type === "ad" ? "Advertisement" : "Post"}
        </span>
        <p className="font-semibold">{string(referral.headline)}</p>
        <p>{string(referral.body)}</p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs underline underline-offset-3 hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3 shrink-0" />
            View {referral.source_type === "ad" ? "ad" : "post"}
          </a>
        ) : null}
      </div>
    </div>
  )
}
