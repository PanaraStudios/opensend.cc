"use client"
import * as React from "react"
import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import type { TemplateInput } from "@/lib/dashboard/template"
import type { EmailDraft, EmailTemplate } from "@/lib/dashboard/types"
import { DEFAULT_TEMPLATE_NAME } from "@/lib/meta/templates"

/** What the WhatsApp editor saves. */
export type WhatsAppPatch = Partial<{
  name: string
  content: unknown
  whatsapp: Partial<
    Pick<
      NonNullable<EmailTemplate["whatsapp"]>,
      "wabaId" | "language" | "category"
    >
  >
}>

export type TemplatePatch = Partial<
  Omit<EmailDraft, "id"> & Pick<EmailTemplate, "alias">
>

export { asTemplate } from "../dashboard/template-record"
import { asTemplate } from "../dashboard/template-record"

/* Convex drops undefined fields, so a field being cleared travels as null
   (the editor document) or empty text (the envelope). */
function wire(patch: TemplatePatch) {
  const { content, from, replyTo, ...rest } = patch
  return {
    ...rest,
    ...("content" in patch ? { content: content ?? null } : {}),
    ...("from" in patch ? { from: from ?? "" } : {}),
    ...("replyTo" in patch ? { replyTo: replyTo ?? "" } : {}),
  }
}

export function useTemplateCommands() {
  const { activeTeamId } = useWorkspace()
  const create = useMutation(api.templates.create)
  const update = useMutation(api.templates.update)
  const publish = useMutation(api.templates.publish)
  const unpublish = useMutation(api.templates.unpublish)
  const duplicate = useMutation(api.templates.duplicate)
  const remove = useMutation(api.templates.remove)
  const submit = useAction(api.whatsapp.templateActions.publish)
  const removeAtMeta = useAction(api.whatsapp.templateActions.remove)
  const sync = useAction(api.whatsapp.templateActions.sync)
  const ref = (id: string) => ({ id: id as Id<"templates"> })
  /* WhatsApp templates are published by submitting them to Meta, and
     deleted there first. */
  const whatsapp = (item: Pick<EmailTemplate, "channel">) =>
    item.channel === "whatsapp"
  return {
    organizationId: activeTeamId,
    addTemplate: async (input: TemplateInput): Promise<string> => {
      const organizationId = requireTeamId(activeTeamId)
      return create({
        ...wire(input),
        name: input.name,
        organizationId,
      })
    },
    /** A WhatsApp draft on the team's first WhatsApp Business Account. */
    addWhatsAppTemplate: async (): Promise<string> =>
      create({
        organizationId: requireTeamId(activeTeamId),
        name: DEFAULT_TEMPLATE_NAME,
        channel: "whatsapp",
      }),
    addPageTemplate: (channel: "messenger" | "instagram") =>
      create({
        organizationId: requireTeamId(activeTeamId),
        channel,
        name: "Untitled Template",
        content: { text: "", quick_replies: [] },
      }),
    updatePageTemplate: (id: string, content: unknown) =>
      update({ ...ref(id), content }),
    updateTemplate: (id: string, patch: TemplatePatch) =>
      update({ ...ref(id), ...wire(patch) }),
    /** A WhatsApp draft's settings or components. */
    updateWhatsAppTemplate: (id: string, patch: WhatsAppPatch) =>
      update({ ...ref(id), ...patch }),
    publishTemplate: (item: Pick<EmailTemplate, "id" | "channel">) =>
      whatsapp(item) ? submit(ref(item.id)) : publish(ref(item.id)),
    unpublishTemplate: (id: string) => unpublish(ref(id)),
    duplicateTemplate: (id: string): Promise<string> => duplicate(ref(id)),
    deleteTemplate: (item: Pick<EmailTemplate, "id" | "channel">) =>
      whatsapp(item) ? removeAtMeta(ref(item.id)) : remove(ref(item.id)),
    /** Imports every template of the team's WhatsApp Business Accounts. */
    syncFromMeta: () => sync({ organizationId: requireTeamId(activeTeamId) }),
  }
}

/** A template made from another email (a broadcast, a sent email). Says how
    it went; resolves to the new id, or null when it failed. */
export function useSaveAsTemplate() {
  const { addTemplate } = useTemplateCommands()
  return async (input: TemplateInput) => {
    try {
      const id = await addTemplate(input)
      toast.add({ type: "success", title: "Template created" })
      return id
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
      return null
    }
  }
}

/** One template of the active team with its draft: undefined while it
    loads, null when there is none. */
export function useTemplate(id: string | undefined) {
  const { activeTeamId } = useWorkspace()
  const row = useTeamQuery(api.templates.get, { id: id! }, { enabled: !!id })
  return React.useMemo(() => {
    if (!activeTeamId || !id) return null
    return row === undefined ? undefined : row && asTemplate(row.template, row)
  }, [activeTeamId, id, row])
}

const serialize = (value: unknown) => JSON.stringify(value ?? null)

/** The editor's write-through for one template. Only fields that differ from
    what this editor last sent go out, so the export that follows a document
    save carries just its markup. Convex runs one client's mutations in
    order, so the newest edit is the one that stays. */
export function useTemplateSaver(item: EmailTemplate) {
  const update = useMutation(api.templates.update)
  const [sent] = React.useState(
    () =>
      new Map(
        (
          [
            "name",
            "subject",
            "preview",
            "html",
            "content",
            "from",
            "replyTo",
          ] as const
        ).map((key) => [key as string, serialize(item[key])])
      )
  )
  const id = item.id
  return React.useCallback(
    async (patch: TemplatePatch) => {
      const keys = Object.keys(patch).filter(
        (key) => sent.get(key) !== serialize(patch[key as keyof TemplatePatch])
      )
      if (keys.length === 0) return
      const changed = Object.fromEntries(
        keys.map((key) => [key, patch[key as keyof TemplatePatch]])
      ) as TemplatePatch
      for (const key of keys)
        sent.set(key, serialize(changed[key as keyof TemplatePatch]))
      try {
        await update({ id: id as Id<"templates">, ...wire(changed) })
      } catch (error) {
        // Owed again: the next save of these fields must go out.
        for (const key of keys) sent.delete(key)
        throw error
      }
    },
    [id, sent, update]
  )
}

/** The team's WhatsApp Business Accounts: undefined while they load. */
export const useWhatsAppAccounts = () =>
  useTeamQuery(api.whatsapp.templates.accounts)
