"use node"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { basename, resolve, dirname } from "node:path"
import { Readable } from "node:stream"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { kindValue } from "./mediaState"
import { graph, metaFetch } from "../meta/graph"
import { decryptSecret } from "../secrets"
import { storeFile } from "../storage/objects"
import { object, string } from "../../lib/meta/parse"
const MAX_RECORDING = 100 * 1024 * 1024
export const fetch = internalAction({
  args: { id: v.id("calls"), kind: kindValue, attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, kind, attempt = 0 }): Promise<null> => {
    const target = await ctx.runQuery(internal.calling.rows.context, { id })
    const media = target?.call[kind]
    if (!target || !media?.mediaId || media.fileId || media.storageId)
      return null
    try {
      const token = await decryptSecret(target.encryptedToken)
      const metadata = object(
        await graph({
          token,
          version: target.version,
          method: "GET",
          path: media.mediaId,
        })
      )
      if (!string(metadata.url))
        throw new Error("Meta media URL is unavailable")
      const maxBytes =
        kind === "transcription" ? 16 * 1024 * 1024 : MAX_RECORDING
      const response = await metaFetch(string(metadata.url), {
        headers: { authorization: `Bearer ${token}` },
        maxBytes,
        timeoutMs: 240000,
        stream: true,
      })
      if (!response.ok || !response.body)
        throw new Error(`Meta media download failed (${response.status})`)
      const source = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>
      )
      const body = (async function* () {
        const hash = createHash("sha256")
        for await (const chunk of source) {
          hash.update(chunk)
          yield chunk
        }
        if (media.sha256 && hash.digest("base64") !== media.sha256)
          throw new Error("Call media SHA-256 mismatch")
      })()
      const file = await storeFile(ctx, {
        organizationId: target.call.organizationId,
        accountId: target.call.accountId,
        feature: "calling",
        body,
        maxBytes,
        contentType:
          media.contentType ??
          (kind === "recording" ? "audio/ogg" : "application/json"),
        filename: `${id}.${kind === "recording" ? "ogg" : "json"}`,
      })
      await ctx.runMutation(internal.calling.mediaState.complete, {
        id,
        kind,
        ...file,
      })
    } catch (e) {
      if (attempt < 3)
        await ctx.scheduler.runAfter(
          10000 * 2 ** attempt,
          internal.calling.media.fetch,
          { id, kind, attempt: attempt + 1 }
        )
      else
        await ctx.runMutation(internal.calling.mediaState.complete, {
          id,
          kind,
          error: e instanceof Error ? e.message : "Call media download failed",
        })
    }
    return null
  },
})
/** Self-hosted Node actions may mount the gateway's finalized recordings read-only.
 * Callback paths are never opened directly; resolve a UUID file under the configured root. */
export const gatewayRecording = internalAction({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const target = await ctx.runQuery(internal.calling.rows.context, { id })
    if (
      !target?.call.gatewayRecordingFile ||
      target.call.recording?.fileId ||
      target.call.recording?.storageId
    )
      return null
    try {
      const root = process.env.CALL_GATEWAY_RECORDINGS_DIR
      if (!root)
        throw new Error(
          "Mount the gateway recording volume and configure CALL_GATEWAY_RECORDINGS_DIR on Convex Node actions."
        )
      const filename = basename(target.call.gatewayRecordingFile)
      if (!/^[a-f0-9-]{36}\.wav$/i.test(filename))
        throw new Error("Invalid gateway recording path")
      const realRoot = await realpath(root),
        path = await realpath(resolve(realRoot, filename))
      if (dirname(path) !== realRoot)
        throw new Error("Recording escaped its configured directory")
      const info = await stat(path)
      if (!info.isFile() || info.size < 1 || info.size > MAX_RECORDING)
        throw new Error("Invalid gateway recording size")
      const file = await storeFile(ctx, {
        organizationId: target.call.organizationId,
        accountId: target.call.accountId,
        feature: "calling",
        contentType: "audio/wav",
        filename,
        body: createReadStream(path),
        maxBytes: MAX_RECORDING,
      })
      await ctx.runMutation(internal.calling.mediaState.complete, {
        id,
        kind: "recording",
        ...file,
      })
    } catch (e) {
      await ctx.runMutation(internal.calling.mediaState.complete, {
        id,
        kind: "recording",
        error: e instanceof Error ? e.message : "Recording upload failed",
      })
    }
    return null
  },
})
