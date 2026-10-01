"use client"

import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  MapPinIcon,
  PhoneIcon,
  ReplyIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { Separator } from "@/components/ui/separator"
import { type RenderedTemplate } from "@/lib/meta/templates"
import { cn } from "@/lib/utils"

const HEADER_ICONS: Partial<
  Record<NonNullable<RenderedTemplate["header"]>["format"], LucideIcon>
> = {
  IMAGE: ImageIcon,
  VIDEO: VideoIcon,
  DOCUMENT: FileTextIcon,
  LOCATION: MapPinIcon,
}
const BUTTON_ICONS: Partial<Record<string, LucideIcon>> = {
  QUICK_REPLY: ReplyIcon,
  URL: ExternalLinkIcon,
  PHONE_NUMBER: PhoneIcon,
  COPY_CODE: CopyIcon,
}

/** One customer-facing template view. Embedded content inherits the Inbox
 * bubble's colors without adding another bubble or card around it. */
export function WhatsAppTemplatePreview({
  rendered,
  embedded = false,
  className,
}: {
  rendered: RenderedTemplate
  embedded?: boolean
  className?: string
}) {
  const MediaIcon = rendered.header && HEADER_ICONS[rendered.header.format]
  const content = (
    <div
      className={cn("flex flex-col gap-1.5", embedded && className)}
      data-testid="whatsapp-preview"
    >
      {MediaIcon ? (
        <div
          className="flex aspect-[1.91/1] w-56 max-w-full items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-label={`${rendered.header!.format.toLowerCase()} header`}
        >
          <MediaIcon className="size-8" />
        </div>
      ) : null}
      {rendered.header?.format === "TEXT" && rendered.header.text ? (
        <p className="font-semibold whitespace-pre-wrap">
          {rendered.header.text}
        </p>
      ) : null}
      <p
        className={cn(
          "whitespace-pre-wrap",
          !rendered.body && "text-muted-foreground"
        )}
      >
        {rendered.body || "Your message"}
      </p>
      {rendered.footer ? (
        <p
          className={cn(
            "text-xs",
            embedded ? "opacity-70" : "text-muted-foreground"
          )}
        >
          {rendered.footer}
        </p>
      ) : null}
      {rendered.buttons.map((button, index) => {
        const Icon = BUTTON_ICONS[button.type]
        return (
          <div key={index} className="flex flex-col gap-1.5">
            <Separator />
            <div
              className={cn(
                "flex min-w-40 items-center justify-center gap-1.5",
                !embedded && "text-primary"
              )}
            >
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
              {button.text}
            </div>
          </div>
        )
      })}
    </div>
  )
  if (embedded) return content
  return (
    <Message className={className}>
      <MessageContent>
        <Bubble variant="outline" className="max-w-[90%]">
          <BubbleContent>{content}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
