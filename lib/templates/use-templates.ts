"use client"
import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import type { TemplateInput } from "@/lib/dashboard/template"
import type { EmailDraft, EmailTemplate } from "@/lib/dashboard/types"

export type TemplatePatch = Partial<
  Omit<EmailDraft, "id"> & Pick<EmailTemplate, "alias">
>

/** A template row, with its draft body where the caller has one. */
export function asTemplate(
  row: Doc<"templates">,
  body?: { html: string; content?: unknown }
): EmailTemplate {
  return {
    id: row._id,
    name: row.name,
    alias: row.alias,
    subject: row.subject,
    preview: row.preview,
    html: body?.html ?? "",
    ...(body?.content
      ? { content: body.content as EmailTemplate["content"] }
      : {}),
    ...(row.from ? { from: row.from } : {}),
    ...(row.replyTo ? { replyTo: row.replyTo } : {}),
    status: row.status,
    variables: row.variables,
    createdAt: row._creationTime,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt ?? null,
  }
}

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
  const ref = (id: string) => ({ id: id as Id<"templates"> })
  return {
    organizationId: activeTeamId,
    addTemplate: async (input: TemplateInput): Promise<string> => {
      if (!activeTeamId) throw new Error("Create a team first")
      return create({
        ...wire(input),
        name: input.name,
        organizationId: activeTeamId,
      })
    },
    updateTemplate: (id: string, patch: TemplatePatch) =>
      update({ ...ref(id), ...wire(patch) }),
    publishTemplate: (id: string) => publish(ref(id)),
    unpublishTemplate: (id: string) => unpublish(ref(id)),
    duplicateTemplate: (id: string): Promise<string> => duplicate(ref(id)),
    deleteTemplate: (id: string) => remove(ref(id)),
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
  const row = useQuery(
    api.templates.get,
    activeTeamId && id ? { organizationId: activeTeamId, id } : "skip"
  )
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
