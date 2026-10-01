"use client"

import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  PhoneIcon,
  ReplyIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"

import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import {
  buttonLabel,
  fillParams,
  formExample,
  type ButtonType,
  type HeaderFormat,
  type TemplateForm,
} from "@/lib/meta/templates"
import { cn } from "@/lib/utils"

const HEADER_ICONS: Partial<Record<HeaderFormat, LucideIcon>> = {
  IMAGE: ImageIcon,
  VIDEO: VideoIcon,
  DOCUMENT: FileTextIcon,
}
const BUTTON_ICONS: Record<ButtonType, LucideIcon> = {
  QUICK_REPLY: ReplyIcon,
  URL: ExternalLinkIcon,
  PHONE_NUMBER: PhoneIcon,
  COPY_CODE: CopyIcon,
}

/** A WhatsApp template as the person receives it, variables shown with
    their examples. The editor's preview and the list's cards both draw it. */
export function WhatsAppTemplatePreview({
  form,
  className,
}: {
  form: TemplateForm
  className?: string
}) {
  const example = (where: "header" | "body") => (param: string) =>
    formExample(form, where, param)?.trim() || undefined
  const MediaIcon = HEADER_ICONS[form.headerFormat]
  return (
    <Message className={className} data-testid="whatsapp-preview">
      <MessageContent>
        <BubbleGroup>
          <Bubble variant="outline" className="max-w-[90%]">
            <BubbleContent className="flex flex-col gap-1.5">
              {MediaIcon ? (
                <div className="flex aspect-[1.91/1] w-56 max-w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <MediaIcon className="size-8" />
                </div>
              ) : null}
              {form.headerFormat === "TEXT" && form.headerText ? (
                <p className="font-semibold">
                  {fillParams(form.headerText, example("header"))}
                </p>
              ) : null}
              <p
                className={cn(
                  "whitespace-pre-wrap",
                  !form.body && "text-muted-foreground"
                )}
              >
                {form.body
                  ? fillParams(form.body, example("body"))
                  : "Your message"}
              </p>
              {form.footer ? (
                <p className="text-xs text-muted-foreground">{form.footer}</p>
              ) : null}
            </BubbleContent>
          </Bubble>
          {form.buttons.map((button, index) => {
            const Icon = BUTTON_ICONS[button.type]
            return (
              <Bubble key={index} variant="outline" className="max-w-[90%]">
                <BubbleContent className="flex min-w-40 items-center justify-center gap-1.5 text-primary">
                  <Icon className="size-4" />
                  {button.type === "COPY_CODE"
                    ? buttonLabel(button.type)
                    : button.text || buttonLabel(button.type)}
                </BubbleContent>
              </Bubble>
            )
          })}
        </BubbleGroup>
      </MessageContent>
    </Message>
  )
}
