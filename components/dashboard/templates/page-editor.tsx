"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldLegend,
  FieldSet,
  FieldError,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EditorTopBar } from "@/components/dashboard/editor-chrome"
import { SaveIndicator } from "@/components/dashboard/broadcasts/editor/screen"
import type { SaveState } from "@/components/dashboard/broadcasts/editor/use-editor"
import { useAutosaveDraft } from "@/components/dashboard/primitives"
import { useTemplateCommands } from "@/lib/templates/use-templates"
import { localTemplate, fillLocalTemplate } from "@/lib/meta/local-templates"
import { templatePublishLabel } from "@/lib/dashboard/template"
import { actionError } from "@/lib/action-error"
import { toast } from "@/components/ui/toast"
import type { EmailTemplate } from "@/lib/dashboard/types"
import {
  LocalTemplatePreview,
  TemplateBadge,
  TemplateMenu,
  usePublishTemplate,
} from "./shared"
import { TemplateTestAction } from "./test-send"
import { localTemplateVariables } from "@/lib/meta/local-templates"
import { pageMessageTextLimit } from "@/lib/meta/payloads"

/** Local Meta templates share the email/WhatsApp editor's naming and actions. */
export function PageTemplateEditorScreen({
  item,
  onDelete,
}: {
  item: EmailTemplate
  onDelete: () => void
}) {
  const router = useRouter()
  const commands = useTemplateCommands()
  const publish = usePublishTemplate()
  const [save, setSave] = React.useState<SaveState>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [examples, setExamples] = React.useState<Record<string, string>>({})
  const autosave = useAutosaveDraft(
    JSON.stringify(item.localContent ?? { text: "", quick_replies: [] }),
    async (json) => {
      try {
        await commands.updatePageTemplate(item.id, JSON.parse(json))
        setSave("saved")
      } catch (error) {
        setSave("idle")
        throw error
      }
    }
  )
  const content = localTemplate(JSON.parse(autosave.draft), true)
  const label = templatePublishLabel(item)
  const textLimit = pageMessageTextLimit(
    item.channel === "instagram" ? "instagram" : "messenger"
  )
  function change(next: typeof content) {
    try {
      const value = localTemplate(next, true)
      autosave.setDraft(JSON.stringify(value))
      setSave("saving")
      setError(null)
    } catch (error) {
      setError(actionError(error))
    }
  }
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <EditorTopBar
        noun="template"
        listHref="/templates"
        listLabel="Templates"
        name={item.name}
        onRename={(name) =>
          void commands
            .updateTemplate(item.id, { name })
            .catch((error) =>
              toast.add({ type: "error", title: actionError(error) })
            )
        }
        badge={<TemplateBadge item={item} />}
      >
        <SaveIndicator save={save} />
        <TemplateTestAction
          templateId={item.id}
          save={() => autosave.flush()}
        />
        <TemplateMenu
          item={item}
          inEditor
          save={() => autosave.flush()}
          onDuplicated={(id) => router.push(`/templates/${id}`)}
          onDelete={onDelete}
        />
        <Button
          size="sm"
          data-testid="editor-publish"
          disabled={!label || !content.text.trim()}
          onClick={async () => {
            if (await autosave.flush()) await publish(item)
          }}
        >
          {label ?? "Published"}
        </Button>
      </EditorTopBar>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
          <FieldSet>
            <FieldLegend>Message</FieldLegend>
            <FieldDescription>
              Recipients must have an open conversation window with your sender.
            </FieldDescription>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="local-template-text">Body</FieldLabel>
                <Textarea
                  id="local-template-text"
                  rows={6}
                  maxLength={textLimit}
                  value={content.text}
                  placeholder="Hi {{{first_name}}}, your order is on its way."
                  onChange={(event) =>
                    change({ ...content, text: event.target.value })
                  }
                />
                <FieldDescription>
                  Use named variables such as {"{{{first_name}}}"}.{" "}
                  {content.text.length}/{textLimit}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>Quick replies</FieldLegend>
            <FieldGroup>
              {content.quick_replies.map((reply, index) => (
                <Field key={index}>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel>Reply {index + 1}</FieldLabel>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove reply ${index + 1}`}
                      onClick={() =>
                        change({
                          ...content,
                          quick_replies: content.quick_replies.filter(
                            (_, i) => i !== index
                          ),
                        })
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <Input
                    aria-label={`Reply ${index + 1} label`}
                    maxLength={20}
                    value={reply.title}
                    onChange={(event) =>
                      change({
                        ...content,
                        quick_replies: content.quick_replies.map((value, i) =>
                          i === index
                            ? { ...value, title: event.target.value }
                            : value
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={`Reply ${index + 1} value`}
                    maxLength={1000}
                    value={reply.payload}
                    onChange={(event) =>
                      change({
                        ...content,
                        quick_replies: content.quick_replies.map((value, i) =>
                          i === index
                            ? { ...value, payload: event.target.value }
                            : value
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </FieldGroup>
            <Button
              variant="outline"
              size="sm"
              disabled={content.quick_replies.length >= 13}
              onClick={() =>
                change({
                  ...content,
                  quick_replies: [
                    ...content.quick_replies,
                    {
                      title: "Reply",
                      payload: `reply_${content.quick_replies.length + 1}`,
                    },
                  ],
                })
              }
            >
              <PlusIcon />
              Add reply
            </Button>
          </FieldSet>
          {error ? <FieldError>{error}</FieldError> : null}
          {localTemplateVariables(content).length ? (
            <FieldSet>
              <FieldLegend>Preview values</FieldLegend>
              <FieldGroup>
                {localTemplateVariables(content).map((key) => (
                  <Field key={key}>
                    <FieldLabel
                      htmlFor={`local-example-${key}`}
                    >{`Variable {{{${key}}}}`}</FieldLabel>
                    <Input
                      id={`local-example-${key}`}
                      value={examples[key] ?? ""}
                      onChange={(event) =>
                        setExamples({ ...examples, [key]: event.target.value })
                      }
                    />
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
          ) : null}
          <FieldSet>
            <FieldLegend>Preview</FieldLegend>
            <LocalTemplatePreview
              content={fillLocalTemplate(content, examples)}
            />
          </FieldSet>
        </div>
      </main>
    </div>
  )
}
