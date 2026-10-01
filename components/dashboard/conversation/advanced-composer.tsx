"use client"
import * as React from "react"
import { SendIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/dashboard/primitives"
import { toast } from "@/components/ui/toast"
import {
  useConversationCommands,
  type ConversationDetail,
} from "@/lib/messages/use-messages"
import { actionError } from "@/lib/action-error"
import {
  composerInteractive,
  INTERACTIVE_ITEMS,
  type InteractiveKind,
} from "@/lib/dashboard/conversation-composer"

export function AdvancedComposer({
  detail,
  open,
  onOpenChange,
}: {
  detail: ConversationDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [kind, setKind] = React.useState<InteractiveKind>("button")
  const [body, setBody] = React.useState("")
  const [header, setHeader] = React.useState("")
  const [footer, setFooter] = React.useState("")
  const [labels, setLabels] = React.useState(["", "", ""])
  const [button, setButton] = React.useState("View options")
  const [url, setUrl] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const { reply } = useConversationCommands()
  const choices = kind === "list" || kind === "button"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send interactive message</DialogTitle>
          <DialogDescription>
            Create a message with choices or an action.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (sending) return
            setSending(true)
            try {
              await reply({
                id: detail.conversation._id,
                body: {
                  type: "interactive",
                  interactive: composerInteractive({
                    kind,
                    body,
                    header,
                    footer,
                    labels,
                    button,
                    url,
                  }),
                },
              })
              onOpenChange(false)
            } catch (error) {
              toast.add({ type: "error", title: actionError(error) })
            } finally {
              setSending(false)
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="interactive-type">Message type</FieldLabel>
              <OptionSelect
                id="interactive-type"
                value={kind}
                onChange={(value) => {
                  setKind(value as InteractiveKind)
                  setLabels(["", "", ""])
                }}
                items={INTERACTIVE_ITEMS}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="interactive-body">Message</FieldLabel>
              <Textarea
                id="interactive-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={kind === "list" ? 4096 : 1024}
              />
            </Field>
            {kind !== "location_request_message" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="interactive-header">
                    Header (optional)
                  </FieldLabel>
                  <Input
                    id="interactive-header"
                    value={header}
                    onChange={(event) => setHeader(event.target.value)}
                    maxLength={60}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="interactive-footer">
                    Footer (optional)
                  </FieldLabel>
                  <Input
                    id="interactive-footer"
                    value={footer}
                    onChange={(event) => setFooter(event.target.value)}
                    maxLength={60}
                  />
                </Field>
              </>
            ) : null}
            {choices
              ? labels.map((label, i) => (
                  <Field key={i}>
                    <FieldLabel htmlFor={`interactive-option-${i}`}>
                      Option {i + 1}
                    </FieldLabel>
                    <Input
                      id={`interactive-option-${i}`}
                      value={label}
                      maxLength={kind === "button" ? 20 : 24}
                      required={i === 0}
                      onChange={(event) =>
                        setLabels((current) =>
                          current.map((value, index) =>
                            index === i ? event.target.value : value
                          )
                        )
                      }
                    />
                  </Field>
                ))
              : null}
            {kind === "list" && labels.length < 10 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setLabels((current) => [...current, ""])}
              >
                Add option
              </Button>
            ) : null}
            {kind === "list" || kind === "cta_url" ? (
              <Field>
                <FieldLabel htmlFor="interactive-button">
                  Button label
                </FieldLabel>
                <Input
                  id="interactive-button"
                  value={button}
                  maxLength={20}
                  required
                  onChange={(event) => setButton(event.target.value)}
                />
              </Field>
            ) : null}
            {kind === "cta_url" ? (
              <Field>
                <FieldLabel htmlFor="interactive-url">URL</FieldLabel>
                <Input
                  id="interactive-url"
                  type="url"
                  value={url}
                  required
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            ) : null}
          </FieldGroup>
          <Button
            type="submit"
            disabled={
              sending ||
              !body.trim() ||
              (choices && !labels.some((label) => label.trim()))
            }
          >
            <SendIcon />
            Send interactive message
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
