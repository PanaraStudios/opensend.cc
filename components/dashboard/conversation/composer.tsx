"use client"
import * as React from "react"
import {
  SendIcon,
  TriangleAlertIcon,
  PlusIcon,
  SmileIcon,
  PaperclipIcon,
} from "lucide-react"
import { FileUploadField } from "@/components/dashboard/file-upload"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { OptionSelect } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { canReply, replySender } from "@/lib/dashboard/conversations"
import { defaultFromAddress } from "@/lib/dashboard/format"
import { useDomainOptions } from "@/lib/domains/use-domains"
import { senderDomainSearch } from "@/lib/dashboard/sender-options"
import { useClock } from "@/lib/time/use-clock"
import {
  useApprovedTemplates,
  useConversationCommands,
  useTemplateVariables,
  type ConversationDetail,
} from "@/lib/messages/use-messages"
import type { Id } from "@/convex/_generated/dataModel"
import { AdvancedComposer } from "./advanced-composer"

/** Text when the channel allows it; on WhatsApp after the window closes,
    an approved template with its variables. */
export function ConversationComposer({
  detail,
}: {
  detail: ConversationDetail
}) {
  const now = useClock()
  const { conversation } = detail
  const open = now === null || canReply(conversation, now)
  return (
    <div className="chat-chrome max-h-[45svh] shrink-0 overflow-y-auto border-t border-border p-3">
      {open ? (
        <TextComposer detail={detail} />
      ) : conversation.channel === "whatsapp" ? (
        <TemplateComposer detail={detail} />
      ) : (
        <Alert>
          <AlertTitle>The 24-hour window is closed.</AlertTitle>
          <AlertDescription>
            Wait for the customer to send a message before replying.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function useSend() {
  const { reply } = useConversationCommands()
  const [sending, setSending] = React.useState(false)
  return {
    sending,
    async send(args: Parameters<typeof reply>[0]) {
      setSending(true)
      try {
        await reply(args)
        return true
      } catch (error) {
        toast.add({ type: "error", title: actionError(error) })
        return false
      } finally {
        setSending(false)
      }
    },
  }
}

function TextComposer({ detail }: { detail: ConversationDetail }) {
  const { conversation } = detail
  const email = conversation.channel === "email"
  const { typing } = useConversationCommands()
  const lastTyping = React.useRef({ id: conversation._id, at: 0 })
  function indicateTyping(on: boolean) {
    if (email || (!on && conversation.channel === "whatsapp")) return
    if (
      on &&
      lastTyping.current.id === conversation._id &&
      Date.now() - lastTyping.current.at < 20_000
    )
      return
    lastTyping.current = { id: conversation._id, at: on ? Date.now() : 0 }
    void typing({ id: conversation._id, on }).catch(() => undefined)
  }
  const [advanced, setAdvanced] = React.useState(false)
  const [templateOpen, setTemplateOpen] = React.useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = React.useState(false)
  const [emojiOpen, setEmojiOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const [fileId, setFileId] = React.useState<Id<"storedFiles">>()
  const [filename, setFilename] = React.useState("")
  const { sending, send } = useSend()
  const [domainSearch, setDomainSearch] = React.useState("")
  const domains = useDomainOptions(
    { status: "verified", search: senderDomainSearch(domainSearch) },
    email
  )
  const senders = domains.map((domain) => defaultFromAddress(domain.name))
  const [from, setFrom] = React.useState<string>()
  const sender = from ?? replySender(detail.lastEmail?.to ?? [], senders)
  const senderItems = senders.map((value) => ({ value, label: value }))

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if ((!text.trim() && !fileId) || sending) return
    if (
      await send({
        id: conversation._id,
        text,
        fileId,
        ...(email ? { from: sender } : {}),
      })
    ) {
      setText("")
      setFileId(undefined)
      setFilename("")
    }
  }
  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {fileId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFileId(undefined)
              setFilename("")
            }}
          >
            Remove {filename}
          </Button>
        ) : null}
        <InputGroup>
          <InputGroupAddon>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                render={
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    aria-label="More message options"
                  />
                }
              >
                <PlusIcon />
              </PopoverTrigger>
              <PopoverContent align="start" side="top">
                {email || conversation.channel === "whatsapp" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setAttachmentsOpen(true)
                      setMenuOpen(false)
                    }}
                  >
                    <PaperclipIcon />
                    Attach file
                  </Button>
                ) : null}
                {conversation.channel === "whatsapp" ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setAdvanced(true)
                        setMenuOpen(false)
                      }}
                    >
                      Interactive message
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setTemplateOpen(true)
                        setMenuOpen(false)
                      }}
                    >
                      Approved template
                    </Button>
                  </>
                ) : null}
              </PopoverContent>
            </Popover>
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger
                render={
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    aria-label="Emoji"
                  />
                }
              >
                <SmileIcon />
              </PopoverTrigger>
              <PopoverContent side="top" className="grid grid-cols-6 gap-1">
                {[
                  "😀",
                  "😊",
                  "😂",
                  "❤️",
                  "👍",
                  "🙏",
                  "🎉",
                  "👋",
                  "✅",
                  "🔥",
                  "📦",
                  "✨",
                  "😅",
                  "😎",
                  "🙌",
                  "🤝",
                  "💬",
                  "💚",
                ].map((emoji) => (
                  <Button
                    key={emoji}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Insert ${emoji}`}
                    onClick={() => {
                      setText((current) => current + emoji)
                      setEmojiOpen(false)
                    }}
                  >
                    {emoji}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </InputGroupAddon>
          <InputGroupTextarea
            aria-label="Reply"
            placeholder={
              email ? `Reply to ${detail.handle}…` : "Type a message"
            }
            value={text}
            rows={1}
            onChange={(event) => {
              setText(event.target.value)
              if (event.target.value) indicateTyping(true)
            }}
            onBlur={() => indicateTyping(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                void submit()
            }}
          />
          <InputGroupAddon align="block-end">
            {email ? (
              <OptionSelect
                size="sm"
                aria-label="From"
                value={sender}
                onChange={setFrom}
                items={senderItems}
                selectedItem={
                  sender ? { value: sender, label: sender } : undefined
                }
                search={{
                  onChange: setDomainSearch,
                  placeholder: "Search domains…",
                }}
                placeholder="Choose a sender"
              />
            ) : null}
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              className="ml-auto"
              disabled={
                (!text.trim() && !fileId) ||
                sending ||
                (email && (!sender || !text.trim()))
              }
            >
              <SendIcon data-icon="inline-start" />
              Send
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <Dialog open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
        <DialogContent>
          <DialogTitle>Attach file</DialogTitle>
          <FileUploadField
            label="Attach file"
            use={email ? "email" : "whatsapp"}
            from={conversation.accountId}
            disabled={sending}
            onUploaded={(id, file) => {
              setFileId(id)
              setFilename(file.name)
              setAttachmentsOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>Send approved template</DialogTitle>
          <TemplateComposer
            detail={detail}
            windowClosed={false}
            onSent={() => setTemplateOpen(false)}
          />
        </DialogContent>
      </Dialog>
      <AdvancedComposer
        detail={detail}
        open={advanced}
        onOpenChange={setAdvanced}
      />
    </>
  )
}

export function TemplateComposer({
  detail,
  windowClosed = true,
  onSent,
}: {
  detail: ConversationDetail
  windowClosed?: boolean
  onSent?: () => void
}) {
  const { conversation } = detail
  const [search, setSearch] = React.useState("")
  const [templateId, setTemplateId] = React.useState<string>()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const templates = useApprovedTemplates(detail.account?.wabaId, search)
  const variables = useTemplateVariables(conversation._id, templateId)
  const { sending, send } = useSend()
  const items = templates.map((row) => ({
    value: row._id,
    label: `${row.name} · ${row.whatsapp?.language ?? ""}`,
  }))
  const missing = (variables ?? []).some((key) => !values[key]?.trim())

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!templateId || missing || sending) return
        const sent = await send({
          id: conversation._id,
          template: {
            id: templateId as Id<"templates">,
            variables: Object.fromEntries(
              (variables ?? []).map((key) => [key, values[key] ?? ""])
            ),
          },
        })
        if (sent) {
          onSent?.()
          setTemplateId(undefined)
          setValues({})
        }
      }}
    >
      {windowClosed ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>The 24-hour window is closed.</AlertTitle>
          <AlertDescription>Send an approved template.</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="reply-template">Template</FieldLabel>
          <OptionSelect
            id="reply-template"
            className="w-full"
            value={templateId}
            onChange={(value) => {
              setTemplateId(value)
              setValues({})
            }}
            items={items}
            search={{ onChange: setSearch, placeholder: "Search templates…" }}
            placeholder="Choose an approved template"
          />
        </Field>
        {(variables ?? []).map((key) => (
          <Field key={key}>
            <FieldLabel htmlFor={`reply-variable-${key}`}>
              {`Variable {{${key}}}`}
            </FieldLabel>
            <Input
              id={`reply-variable-${key}`}
              value={values[key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </FieldGroup>
      <Button
        type="submit"
        className="self-end"
        disabled={!templateId || variables === undefined || missing || sending}
      >
        <SendIcon data-icon="inline-start" />
        Send template
      </Button>
    </form>
  )
}
