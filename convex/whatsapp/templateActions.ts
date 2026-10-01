"use node"
import { readFile } from "../storage/objects"
import { v, ConvexError } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { callerValue, type Caller } from "../api/caller"
import { decryptSecret } from "../secrets"
import { friendly, graph, graphFailure, graphLocalOrigin } from "../meta/graph"
import { publicFetch } from "../../lib/net/public-fetch"
import { editableAtMeta } from "./rows"
import {
  TEMPLATE_FIELDS,
  TEMPLATE_STATUSES,
  TEMPLATE_CATEGORIES,
  readMetaTemplates,
  templateProblems,
  type TemplateComponent,
} from "../../lib/meta/templates"

/* Graph calls for WhatsApp templates
   (https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api):
   publishing submits the draft (`POST /{waba}/message_templates`, or
   `POST /{template-id}` for an edit), deleting removes it at Meta first
   (`DELETE /{waba}/message_templates?name=&hsm_id=`), and a sync reads
   every template a WABA has (`GET /{waba}/message_templates`, paged). The
   dashboard's actions check the caller may write to the team; the REST
   API's check its caller. */

type Access = {
  connectionId: Id<"metaConnections">
  encryptedToken: string
  graphVersion: string
  appId: string
}

/** Meta caps a sync at 6000 templates per WABA; pages of 100. */
const PAGE_SIZE = 100
const MAX_PAGES = 60
/** Media header samples: Meta takes JPEG, PNG, MP4 and PDF files. */
const SAMPLE_TYPES = ["image/jpeg", "image/png", "video/mp4", "application/pdf"]
const SAMPLE_BYTES = 16 * 1024 * 1024

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  values.find((known) => known === value)

/** Uploads a media header's sample URL through Meta's Resumable Upload API
    (https://developers.facebook.com/docs/graph-api/guides/upload) and
    returns the handle template creation takes. */
async function uploadSample(
  access: Access,
  token: string,
  input: string | { blob: Blob; filename: string }
) {
  let blob: Blob
  if (typeof input === "string") {
    const response = await publicFetch(input, {
      timeoutMs: 30_000,
      maxBytes: SAMPLE_BYTES,
      localOrigin: graphLocalOrigin(),
    })
    if (!response.ok)
      throw new ConvexError(`The sample file returned HTTP ${response.status}`)
    blob = await response.blob()
  } else blob = input.blob
  const type = blob.type.split(";")[0].trim().toLowerCase()
  if (!SAMPLE_TYPES.includes(type) || !blob.size || blob.size > SAMPLE_BYTES)
    throw new ConvexError("Use a JPEG, PNG, MP4 or PDF sample up to 16 MB")
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const session = await graph<{ id?: unknown }>({
    token,
    method: "POST",
    path: `${access.appId}/uploads`,
    query: {
      file_name:
        typeof input === "string"
          ? input.split("/").pop()?.split("?")[0] || "sample"
          : input.filename,
      file_length: bytes.byteLength,
      file_type: type,
    },
    version: access.graphVersion,
  })
  if (typeof session.id !== "string" || !session.id.startsWith("upload:"))
    throw new ConvexError("Meta did not start the sample upload")
  const uploaded = await graph<{ h?: unknown }>({
    token,
    method: "POST",
    path: session.id,
    version: access.graphVersion,
    body: { bytes, contentType: type },
    headers: { authorization: `OAuth ${token}`, file_offset: "0" },
  })
  if (typeof uploaded.h !== "string" || !uploaded.h)
    throw new ConvexError("Meta did not return the sample's handle")
  return uploaded.h
}

/** The components as Meta takes them: a media header's sample URL becomes
    an uploaded handle. */
async function submittable(
  ctx: ActionCtx,
  templateId: Id<"templates">,
  caller: Caller | undefined,
  access: Access,
  token: string,
  components: TemplateComponent[]
) {
  return Promise.all(
    components.map(async (component) => {
      const example = record(component.example)
      const handles = example.header_handle
      const sample = Array.isArray(handles) ? handles[0] : undefined
      if (
        String(component.type).toUpperCase() !== "HEADER" ||
        typeof sample !== "string" ||
        (!/^https?:\/\//.test(sample) && !sample.startsWith("opensend-file:"))
      )
        return component
      let input: string | { blob: Blob; filename: string } = sample
      if (sample.startsWith("opensend-file:")) {
        const file = await ctx.runQuery(
          internal.whatsapp.templates.sampleFile,
          { templateId, id: sample.slice("opensend-file:".length), caller }
        )
        const blob = await readFile(ctx, { fileId: file._id })
        if (!blob) throw new ConvexError("Sample file is missing")
        input = { blob, filename: file.filename ?? "sample" }
      }
      return {
        ...component,
        example: {
          ...example,
          header_handle: [await uploadSample(access, token, input)],
        },
      }
    })
  )
}

async function submitTemplate(
  ctx: ActionCtx,
  templateId: Id<"templates">,
  caller?: Caller
) {
  const target = await ctx.runQuery(internal.whatsapp.templates.submitTarget, {
    templateId,
    caller,
  })
  const { whatsapp, access } = target
  const components = target.components as TemplateComponent[]
  const problems = templateProblems({
    name: target.name,
    language: whatsapp.language,
    category: whatsapp.category,
    parameterFormat: whatsapp.parameterFormat,
    components,
  })
  if (problems.length) throw new ConvexError(problems[0])
  if (!editableAtMeta(whatsapp))
    throw new ConvexError(
      "Meta is reviewing this template. Edit it again once it is approved or rejected."
    )
  const token = await decryptSecret(access.encryptedToken)
  await friendly(
    ctx,
    async () => {
      const sent = await submittable(
        ctx,
        templateId,
        caller,
        access,
        token,
        components
      )
      if (!whatsapp.metaTemplateId) {
        const created = await graph<Record<string, unknown>>({
          token,
          method: "POST",
          path: `${whatsapp.wabaId}/message_templates`,
          version: access.graphVersion,
          body: {
            json: {
              name: target.name,
              language: whatsapp.language,
              category: whatsapp.category,
              parameter_format: whatsapp.parameterFormat,
              components: sent,
            },
          },
        })
        const id =
          typeof created.id === "number" ? String(created.id) : created.id
        if (typeof id !== "string" || !id)
          throw new ConvexError("Meta returned no template id")
        await ctx.runMutation(internal.whatsapp.templates.recordSubmission, {
          templateId,
          updatedAt: target.updatedAt,
          metaTemplateId: id,
          metaStatus: oneOf(TEMPLATE_STATUSES, created.status) ?? "PENDING",
          category: oneOf(TEMPLATE_CATEGORIES, created.category),
          components: sent,
        })
        return
      }
      // An approved template keeps its category; Meta refuses a change.
      await graph({
        token,
        method: "POST",
        path: whatsapp.metaTemplateId,
        version: access.graphVersion,
        body: {
          json: {
            components: sent,
            parameter_format: whatsapp.parameterFormat,
            ...(whatsapp.metaStatus === "APPROVED"
              ? {}
              : { category: whatsapp.category }),
          },
        },
      })
      /* An edit goes back to review; the status Meta reports now is the
         one sends must respect until its webhook arrives. */
      const current = await graph<Record<string, unknown>>({
        token,
        method: "GET",
        path: whatsapp.metaTemplateId,
        query: { fields: "status,rejected_reason" },
        version: access.graphVersion,
      })
      await ctx.runMutation(internal.whatsapp.templates.recordSubmission, {
        templateId,
        updatedAt: target.updatedAt,
        metaTemplateId: whatsapp.metaTemplateId,
        metaStatus: oneOf(TEMPLATE_STATUSES, current.status) ?? "PENDING",
        components: sent,
      })
    },
    access.connectionId
  )
  return null
}

async function deleteTemplate(
  ctx: ActionCtx,
  templateId: Id<"templates">,
  caller?: Caller
) {
  const target = await ctx.runQuery(internal.whatsapp.templates.deleteTarget, {
    templateId,
    caller,
  })
  if (target.metaTemplateId && target.access) {
    const access = target.access
    await friendly(
      ctx,
      async () =>
        graph({
          token: await decryptSecret(access.encryptedToken),
          method: "DELETE",
          path: `${target.wabaId}/message_templates`,
          // With the id, only this language's template goes.
          query: { name: target.name, hsm_id: target.metaTemplateId },
          version: access.graphVersion,
        }),
      access.connectionId
    )
  }
  await ctx.runMutation(internal.whatsapp.templates.removeLocal, {
    templateId,
  })
  return null
}

/** Reads every template of a WABA from Meta into the team's templates.
    Returns how many Meta listed; a WABA that is not connected syncs none. */
async function syncWaba(ctx: ActionCtx, wabaId: string) {
  const target = await ctx.runQuery(internal.whatsapp.templates.syncTarget, {
    wabaId,
  })
  if (!target) return 0
  const { organizationId, access } = target
  const token = await decryptSecret(access.encryptedToken)
  const syncedAt = Date.now()
  let after: string | undefined
  let count = 0
  const seenMetaIds: string[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await friendly(
      ctx,
      () =>
        graph<Record<string, unknown>>({
          token,
          method: "GET",
          path: `${wabaId}/message_templates`,
          query: { fields: TEMPLATE_FIELDS, limit: PAGE_SIZE, after },
          version: access.graphVersion,
        }),
      access.connectionId
    )
    const templates = readMetaTemplates(result.data)
    await ctx.runMutation(internal.whatsapp.templates.upsertSynced, {
      organizationId,
      wabaId,
      syncedAt,
      templates,
    })
    seenMetaIds.push(...templates.map((template) => template.id))
    count += templates.length
    const paging = record(result.paging)
    const cursor = record(paging.cursors).after
    if (typeof paging.next !== "string" || typeof cursor !== "string") {
      // Only a complete listing can say which templates Meta dropped.
      await ctx.runMutation(internal.whatsapp.templates.finishSync, {
        organizationId,
        wabaId,
        syncedAt,
        cursor: null,
        seenMetaIds,
      })
      return count
    }
    after = cursor
  }
  return count
}

/** Submits a draft to Meta for review, or an edit of a submitted one. */
export const publish = action({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: (ctx, { id }): Promise<null> => submitTemplate(ctx, id),
})

/** Deletes a template at Meta, then here. */
export const remove = action({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: (ctx, { id }): Promise<null> => deleteTemplate(ctx, id),
})

/** "Sync from Meta": imports every template of the team's WABAs. */
export const sync = action({
  args: { organizationId: v.string() },
  returns: v.object({ synced: v.number() }),
  handler: async (ctx, { organizationId }) => {
    const wabaIds: string[] = await ctx.runQuery(
      internal.whatsapp.templates.teamWabaIds,
      { organizationId }
    )
    if (!wabaIds.length)
      throw new ConvexError(
        "Connect a WhatsApp Business Account on the Channels page first"
      )
    let synced = 0
    for (const wabaId of wabaIds) synced += await syncWaba(ctx, wabaId)
    return { synced }
  },
})

/** The REST API's publish and delete, for its checked caller. */
export const submitForCaller = internalAction({
  args: { templateId: v.id("templates"), caller: callerValue },
  returns: v.null(),
  handler: (ctx, { templateId, caller }): Promise<null> =>
    submitTemplate(ctx, templateId, caller),
})
export const removeForCaller = internalAction({
  args: { templateId: v.id("templates"), caller: callerValue },
  returns: v.null(),
  handler: (ctx, { templateId, caller }): Promise<null> =>
    deleteTemplate(ctx, templateId, caller),
})

/** One WABA's sync, after connecting and from the hourly cron. A failure
    is logged; the next run tries again. */
export const syncAccount = internalAction({
  args: { wabaId: v.string() },
  returns: v.null(),
  handler: async (ctx, { wabaId }) => {
    try {
      await syncWaba(ctx, wabaId)
    } catch (error) {
      console.warn(
        `WhatsApp template sync failed for WABA ${wabaId}: ${graphFailure(error)}`
      )
    }
    return null
  },
})
