"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CircleAlertIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { EditorTopBar } from "@/components/dashboard/editor-chrome"
import {
  OptionSelect,
  useAutosaveDraft,
} from "@/components/dashboard/primitives"
import { SaveIndicator } from "@/components/dashboard/broadcasts/editor/screen"
import type { SaveState } from "@/components/dashboard/broadcasts/editor/use-editor"
import {
  TemplateBadge,
  TemplateMenu,
  usePublishTemplate,
} from "@/components/dashboard/templates/shared"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { actionError } from "@/lib/action-error"
import { templatePublishLabel } from "@/lib/dashboard/template"
import type { EmailTemplate } from "@/lib/dashboard/types"
import {
  BUTTON_TYPES,
  HEADER_FORMATS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  TEMPLATE_LIMITS,
  buttonLabel,
  componentsFromForm,
  formFromComponents,
  formParameterFormat,
  storedComponents,
  templateCategoryLabel,
  templateNameFrom,
  templateProblems,
  templateVariables,
  textParams,
  variableLabel,
  type ButtonType,
  type FormButton,
  type HeaderFormat,
  type TemplateCategory,
  type TemplateForm,
} from "@/lib/meta/templates"
import {
  useTemplateCommands,
  useWhatsAppAccounts,
  type WhatsAppPatch,
} from "@/lib/templates/use-templates"

/* The WhatsApp template editor: Meta's settings and components as a form
   on the left, the message as the person receives it on the right. It sits
   in the same full-screen chrome as the email editor and saves the draft
   as it is typed, the same way. */

const HEADER_LABELS: Record<HeaderFormat, string> = {
  NONE: "None",
  TEXT: "Text",
  IMAGE: "Image",
  VIDEO: "Video",
  DOCUMENT: "Document",
}
const HEADER_ITEMS = HEADER_FORMATS.map((value) => ({
  value,
  label: HEADER_LABELS[value],
}))
const CATEGORY_ITEMS = TEMPLATE_CATEGORIES.map((value) => ({
  value,
  label: templateCategoryLabel(value),
}))
const LANGUAGE_ITEMS = TEMPLATE_LANGUAGES.map(([value, label]) => ({
  value,
  label,
}))
const CATEGORY_HINTS: Record<TemplateCategory, string> = {
  MARKETING: "Promotions, offers, updates and invitations.",
  UTILITY: "Updates about an order or account the person asked for.",
  AUTHENTICATION: "One-time passcodes. Meta sets their text.",
}

const newButton = (type: ButtonType): FormButton =>
  type === "COPY_CODE"
    ? { type }
    : type === "URL"
      ? { type, text: "", url: "https://" }
      : type === "PHONE_NUMBER"
        ? { type, text: "", phone: "" }
        : { type, text: "" }

/** The next variable to insert: `{{n}}` after the body's numbered ones,
    or a name when the template uses names. */
function nextVariable(form: TemplateForm) {
  if (formParameterFormat(form) === "named") return "{{variable}}"
  const used = textParams(form.body).map(Number).filter(Number.isInteger)
  return `{{${Math.max(0, ...used) + 1}}}`
}

export function WhatsAppTemplateEditorScreen({
  item,
  onDelete,
}: {
  item: EmailTemplate
  onDelete: () => void
}) {
  const router = useRouter()
  const { updateWhatsAppTemplate } = useTemplateCommands()
  const publish = usePublishTemplate()
  const accounts = useWhatsAppAccounts()
  const whatsapp = item.whatsapp
  const submitted = !!whatsapp?.metaTemplateId
  const stored = React.useMemo(
    () => JSON.stringify(storedComponents(item.components)),
    [item.components]
  )
  /* The form is this screen's own: an example typed for a variable that is
     half-edited stays until the variable is whole again. */
  const [initial] = React.useState(() =>
    formFromComponents(storedComponents(item.components))
  )
  const [form, setForm] = React.useState(initial.form)
  const [save, setSave] = React.useState<SaveState>("idle")
  const [problems, setProblems] = React.useState<string[]>([])
  const body = React.useRef<HTMLTextAreaElement>(null)
  const readOnly = !initial.supported
  const [languageSearch, setLanguageSearch] = React.useState("")
  const languageItems = React.useMemo(() => {
    const query = languageSearch.trim().toLowerCase()
    return query
      ? LANGUAGE_ITEMS.filter((item) =>
          `${item.label} ${item.value}`.toLowerCase().includes(query)
        )
      : LANGUAGE_ITEMS
  }, [languageSearch])
  const autosave = useAutosaveDraft(stored, async (json) => {
    try {
      await updateWhatsAppTemplate(item.id, { content: JSON.parse(json) })
      setSave("saved")
    } catch (error) {
      setSave("idle")
      throw error
    }
  })

  function change(next: TemplateForm) {
    setForm(next)
    setProblems([])
    setSave("saving")
    autosave.setDraft(JSON.stringify(componentsFromForm(next)))
  }
  const patch = (next: Partial<TemplateForm>) => change({ ...form, ...next })
  const setButton = (index: number, next: FormButton) =>
    patch({
      buttons: form.buttons.map((button, i) => (i === index ? next : button)),
    })
  function commit(update: WhatsAppPatch) {
    void updateWhatsAppTemplate(item.id, update).catch((error) =>
      toast.add({ type: "error", title: actionError(error) })
    )
  }
  function insertVariable() {
    const field = body.current
    const token = nextVariable(form)
    const at = field?.selectionStart ?? form.body.length
    const end = field?.selectionEnd ?? at
    patch({ body: `${form.body.slice(0, at)}${token}${form.body.slice(end)}` })
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const components = componentsFromForm(form)
  const format = formParameterFormat(form)
  const variables = templateVariables(components, format).filter(
    (variable) => variable.where !== "header_media"
  )
  const counts = (type: ButtonType) =>
    form.buttons.filter((button) => button.type === type).length
  const publishLabel = templatePublishLabel(item)

  async function submit() {
    if (!whatsapp) return
    const found = templateProblems({
      name: item.name,
      language: whatsapp.language,
      category: whatsapp.category,
      parameterFormat: format,
      components,
    })
    setProblems(found)
    if (found.length) return
    // What goes to Meta is the form on screen, so it is saved first.
    if (await autosave.flush()) await publish(item)
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <EditorTopBar
        noun="template"
        listHref="/templates"
        listLabel="Templates"
        name={item.name}
        nameReadOnly={submitted}
        onRename={(name) => commit({ name: templateNameFrom(name) })}
        badge={<TemplateBadge item={item} />}
      >
        <SaveIndicator save={save} />
        <TemplateMenu
          item={item}
          inEditor
          save={() => autosave.flush()}
          onDuplicated={(next) => router.push(`/templates/${next}`)}
          onDelete={onDelete}
        />
        <Button
          size="sm"
          data-testid="editor-publish"
          disabled={!publishLabel || readOnly}
          onClick={() => void submit()}
        >
          {publishLabel ?? "Published"}
        </Button>
      </EditorTopBar>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
            {whatsapp?.metaStatus === "REJECTED" ? (
              <Alert variant="destructive" data-testid="template-rejected">
                <CircleAlertIcon />
                <AlertTitle>Meta rejected this template</AlertTitle>
                <AlertDescription>
                  {whatsapp.rejectedReason ?? "Meta gave no reason."} Edit it
                  and publish again to ask for another review.
                </AlertDescription>
              </Alert>
            ) : null}
            {readOnly ? (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Edit this template in WhatsApp Manager</AlertTitle>
                <AlertDescription>
                  It uses parts this editor cannot change, like a carousel or a
                  one-time passcode button.
                </AlertDescription>
              </Alert>
            ) : null}
            {problems.length ? (
              <Alert variant="warning" data-testid="template-problems">
                <TriangleAlertIcon />
                <AlertTitle>Meta would refuse this template</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            <FieldSet disabled={readOnly}>
              <FieldLegend>Settings</FieldLegend>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {accounts && accounts.length > 1 ? (
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="template-waba">
                      WhatsApp Business Account
                    </FieldLabel>
                    <OptionSelect
                      id="template-waba"
                      className="w-full"
                      disabled={submitted}
                      value={whatsapp?.wabaId}
                      items={accounts.map((account) => ({
                        value: account.wabaId,
                        label: account.name ?? account.wabaId,
                      }))}
                      onChange={(wabaId) => commit({ whatsapp: { wabaId } })}
                    />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="template-language">Language</FieldLabel>
                  <OptionSelect
                    id="template-language"
                    className="w-full"
                    disabled={submitted}
                    value={whatsapp?.language}
                    items={languageItems}
                    selectedItem={LANGUAGE_ITEMS.find(
                      (item) => item.value === whatsapp?.language
                    )}
                    search={{
                      onChange: setLanguageSearch,
                      placeholder: "Search languages…",
                    }}
                    onChange={(language) => commit({ whatsapp: { language } })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="template-category">Category</FieldLabel>
                  <OptionSelect
                    id="template-category"
                    className="w-full"
                    disabled={whatsapp?.metaStatus === "APPROVED"}
                    value={whatsapp?.category}
                    items={CATEGORY_ITEMS}
                    onChange={(category) =>
                      commit({
                        whatsapp: { category: category as TemplateCategory },
                      })
                    }
                  />
                  {whatsapp ? (
                    <FieldDescription>
                      {CATEGORY_HINTS[whatsapp.category]}
                    </FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet disabled={readOnly}>
              <FieldLegend>Message</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="template-header">Header</FieldLabel>
                  <OptionSelect
                    id="template-header"
                    className="w-full"
                    value={form.headerFormat}
                    items={HEADER_ITEMS}
                    onChange={(headerFormat) =>
                      patch({ headerFormat: headerFormat as HeaderFormat })
                    }
                  />
                  {form.headerFormat === "TEXT" ? (
                    <Input
                      aria-label="Header text"
                      value={form.headerText}
                      maxLength={TEMPLATE_LIMITS.headerText}
                      placeholder="Your order is on its way"
                      onChange={(event) =>
                        patch({ headerText: event.target.value })
                      }
                    />
                  ) : form.headerFormat !== "NONE" ? (
                    <>
                      <Input
                        aria-label="Sample file URL"
                        value={form.headerSample}
                        placeholder="https://example.com/sample.png"
                        onChange={(event) =>
                          patch({ headerSample: event.target.value })
                        }
                      />
                      <FieldDescription>
                        Meta reviews the template with this sample. Each send
                        gives its own file.
                      </FieldDescription>
                    </>
                  ) : null}
                </Field>
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="template-body">Body</FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="add-variable"
                      onClick={insertVariable}
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add variable
                    </Button>
                  </div>
                  <Textarea
                    ref={body}
                    id="template-body"
                    rows={6}
                    value={form.body}
                    maxLength={TEMPLATE_LIMITS.body}
                    placeholder="Hi {{1}}, your order has shipped."
                    onChange={(event) => patch({ body: event.target.value })}
                  />
                  <FieldDescription>
                    Variables are {"{{1}}"}, {"{{2}}"}… or names like{" "}
                    {"{{first_name}}"}. {form.body.length}/
                    {TEMPLATE_LIMITS.body}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="template-footer">Footer</FieldLabel>
                  <Input
                    id="template-footer"
                    value={form.footer}
                    maxLength={TEMPLATE_LIMITS.footer}
                    placeholder="Reply STOP to opt out"
                    onChange={(event) => patch({ footer: event.target.value })}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet disabled={readOnly}>
              <div className="flex items-center justify-between gap-2">
                <FieldLegend>Buttons</FieldLegend>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="add-button"
                        disabled={
                          readOnly ||
                          form.buttons.length >= TEMPLATE_LIMITS.buttons
                        }
                      />
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add button
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuGroup>
                      {BUTTON_TYPES.map((type) => (
                        <DropdownMenuItem
                          key={type}
                          disabled={
                            counts(type) >= TEMPLATE_LIMITS.perType[type]
                          }
                          onClick={() =>
                            patch({
                              buttons: [...form.buttons, newButton(type)],
                            })
                          }
                        >
                          {buttonLabel(type)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {form.buttons.length === 0 ? (
                <FieldDescription>
                  Up to {TEMPLATE_LIMITS.buttons} buttons. Keep quick replies
                  together.
                </FieldDescription>
              ) : (
                <FieldGroup>
                  {form.buttons.map((button, index) => (
                    <Field key={index} data-testid="template-button">
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel>{buttonLabel(button.type)}</FieldLabel>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove button"
                          onClick={() =>
                            patch({
                              buttons: form.buttons.filter(
                                (_, i) => i !== index
                              ),
                            })
                          }
                        >
                          <XIcon />
                        </Button>
                      </div>
                      {button.type === "COPY_CODE" ? (
                        <FieldDescription>
                          Each send gives the code; add a sample under examples.
                        </FieldDescription>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            aria-label="Button label"
                            value={button.text}
                            maxLength={TEMPLATE_LIMITS.buttonText}
                            placeholder="Label"
                            onChange={(event) =>
                              setButton(index, {
                                ...button,
                                text: event.target.value,
                              })
                            }
                          />
                          {button.type === "URL" ? (
                            <Input
                              aria-label="Button URL"
                              value={button.url}
                              maxLength={TEMPLATE_LIMITS.url}
                              placeholder="https://example.com/{{1}}"
                              onChange={(event) =>
                                setButton(index, {
                                  ...button,
                                  url: event.target.value,
                                })
                              }
                            />
                          ) : button.type === "PHONE_NUMBER" ? (
                            <Input
                              aria-label="Phone number"
                              type="tel"
                              value={button.phone}
                              maxLength={TEMPLATE_LIMITS.phone}
                              placeholder="+15550100"
                              onChange={(event) =>
                                setButton(index, {
                                  ...button,
                                  phone: event.target.value,
                                })
                              }
                            />
                          ) : null}
                        </div>
                      )}
                    </Field>
                  ))}
                </FieldGroup>
              )}
            </FieldSet>

            {variables.length ? (
              <FieldSet disabled={readOnly}>
                <FieldLegend>Examples</FieldLegend>
                <FieldDescription>
                  Meta reviews the template with these values. Sends fill in
                  their own.
                </FieldDescription>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  {variables.map((variable) => (
                    <Field key={variable.key}>
                      <FieldLabel htmlFor={`example-${variable.key}`}>
                        Example for {variableLabel(variable)}
                      </FieldLabel>
                      <Input
                        id={`example-${variable.key}`}
                        value={form.examples[variable.key] ?? ""}
                        onChange={(event) =>
                          patch({
                            examples: {
                              ...form.examples,
                              [variable.key]: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            ) : null}
          </div>
        </main>

        <aside
          aria-label="Preview"
          className="hidden w-96 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-muted/40 p-6 lg:flex"
        >
          <h2 className="text-sm font-medium text-muted-foreground">Preview</h2>
          <WhatsAppTemplatePreview form={form} />
        </aside>
      </div>
    </div>
  )
}
