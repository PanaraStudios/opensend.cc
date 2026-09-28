"use node"
import { simpleParser, type AddressObject } from "mailparser"
import { v, type Infer } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  receivedAttachment,
  receivedMetadata,
  receivedContent,
} from "./tables/received"
import { MAX_INBOUND_BYTES } from "./ses/inboundTransfer"
import { MAX_RECEIVED_ATTACHMENTS } from "./received"

const addresses = (value: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) =>
    item.value.flatMap((address) => (address.address ? [address.address] : []))
  )

export const parse = internalAction({
  args: { id: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const row = await ctx.runQuery(internal.received.parseSource, { id })
    if (!row?.storageId) return null
    const raw = await ctx.storage.get(row.storageId)
    if (!raw) throw new Error("Stored inbound MIME is missing")
    const notification = JSON.parse(row.notification)
    const common = notification.mail?.commonHeaders ?? {}
    let metadata: Infer<typeof receivedMetadata> = {
      from: String(common.from?.[0] ?? notification.mail?.source ?? ""),
      sender: String(notification.mail?.source ?? "")
        .trim()
        .toLowerCase(),
      to: notification.receipt?.recipients?.slice(0, 50) ?? [],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: String(common.subject ?? ""),
      messageId: String(common.messageId ?? row.sesMessageId),
    }
    let content: Infer<typeof receivedContent> = {
      html: "",
      text: "",
      headers: {},
    }
    let parseError: string | undefined
    let parsed: Awaited<ReturnType<typeof simpleParser>> | undefined
    try {
      if (raw.size > MAX_INBOUND_BYTES)
        throw new Error("Inbound message exceeds 40 MiB")
      parsed = await simpleParser(Buffer.from(await raw.arrayBuffer()), {
        skipHtmlToText: true,
        skipTextToHtml: true,
        skipImageLinks: true,
      })
      if (!parsed.headerLines.some((header) => header.line.includes(":")))
        throw new Error("Message has no MIME headers")
      if (parsed.attachments.length > MAX_RECEIVED_ATTACHMENTS)
        throw new Error("Inbound message exceeds 100 attachments")
      const attachmentMetadata = parsed.attachments.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        contentId: file.contentId,
        contentDisposition: file.contentDisposition,
        size: file.size,
      }))
      if (Buffer.byteLength(JSON.stringify(attachmentMetadata)) > 32 * 1024)
        throw new Error("Inbound attachment metadata exceeds 32 KiB")
      const headers: Record<string, string> = {}
      for (const header of parsed.headerLines) {
        if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(header.key)) continue
        const value = header.line.slice(header.line.indexOf(":") + 1).trim()
        headers[header.key] = headers[header.key]
          ? `${headers[header.key]}\n${value}`
          : value
      }
      metadata = {
        from: parsed.from?.text ?? metadata.from,
        sender: addresses(parsed.from)[0]?.toLowerCase() ?? "",
        to: addresses(parsed.to),
        cc: addresses(parsed.cc),
        bcc: addresses(parsed.bcc),
        replyTo: addresses(parsed.replyTo),
        subject: parsed.subject ?? "",
        messageId: parsed.messageId ?? row.sesMessageId,
        ...(parsed.date && Number.isFinite(parsed.date.getTime())
          ? { date: parsed.date.getTime() }
          : {}),
      }
      content = { html: parsed.html || "", text: parsed.text ?? "", headers }
      // Stay below Convex's document and action-argument limits. Raw MIME remains downloadable.
      if (
        Object.keys(headers).length > 512 ||
        Buffer.byteLength(JSON.stringify(content)) > 600 * 1024 ||
        Buffer.byteLength(JSON.stringify(metadata)) > 32 * 1024 ||
        [metadata.to, metadata.cc, metadata.bcc, metadata.replyTo].some(
          (items) => items.length > 100
        )
      )
        throw new Error("Parsed message exceeds content or address limits")
    } catch (error) {
      parseError =
        error instanceof Error
          ? error.message.slice(0, 1024)
          : "Unable to parse MIME"
      content = { html: "", text: "", headers: {} }
      metadata = {
        ...metadata,
        from: metadata.from.slice(0, 1024),
        sender: metadata.sender.slice(0, 320),
        subject: metadata.subject.slice(0, 1024),
        messageId: metadata.messageId.slice(0, 1024),
        to: metadata.to.slice(0, 50).map((x) => x.slice(0, 320)),
        cc: [],
        bcc: [],
        replyTo: [],
      }
      parsed = undefined
    }
    const stored: Id<"_storage">[] = []
    try {
      const attachments: Infer<typeof receivedAttachment>[] = []
      for (const file of parsed?.attachments ?? []) {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(file.content)], { type: file.contentType })
        )
        stored.push(storageId)
        attachments.push({
          storageId,
          filename: file.filename?.slice(0, 1024) ?? null,
          contentType: file.contentType.slice(0, 256),
          contentId:
            file.contentId?.replace(/^<|>$/g, "").slice(0, 1024) ?? null,
          contentDisposition: file.contentDisposition ?? null,
          size: file.size,
        })
      }
      const committed = await ctx.runMutation(internal.received.complete, {
        id,
        metadata,
        content,
        attachments,
        parseError,
      })
      if (committed) stored.length = 0
    } finally {
      for (const storageId of stored) await ctx.storage.delete(storageId)
    }
    return null
  },
})
