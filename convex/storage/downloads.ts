import type { HttpRouter } from "convex/server"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { verifyFileToken } from "../fileDownloads"
import { limitedBody, BodyTooLarge } from "../ses/web"
import { LOCAL_UPLOAD_LIMIT, verifyUpload } from "../../lib/storage/policy"

export function registerStoredFileRoutes(http: HttpRouter) {
  http.route({
    method: "POST",
    pathPrefix: "/storage-upload/",
    handler: httpAction(async (ctx, req) => {
      try {
        const payload = await verifyFileToken(
          new URL(req.url).pathname.slice("/storage-upload/".length),
          "storage-upload"
        )
        if (typeof payload.fileId !== "string")
          return new Response(null, { status: 404 })
        const id = payload.fileId as Id<"storedFiles">
        const row = await ctx.runQuery(internal.storage.files.get, { id })
        if (
          !row ||
          row.state !== "pending" ||
          row.storageId ||
          row.provider !== "convex" ||
          !row.expiresAt ||
          row.expiresAt <= Date.now()
        )
          return new Response(null, { status: 404 })
        const bytes = await limitedBody(
          req,
          Math.min(row.size, LOCAL_UPLOAD_LIMIT),
          { raw: true }
        )
        verifyUpload(row, {
          size: bytes.byteLength,
          contentType: req.headers.get("content-type") ?? "",
        })
        const storageId = await ctx.storage.store(
          new Blob([bytes], { type: row.contentType })
        )
        await ctx.runMutation(internal.storage.files.localStored, {
          id,
          storageId,
        })
        return Response.json(
          { storageId },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        )
      } catch (e) {
        return new Response(null, {
          status: e instanceof BodyTooLarge ? 413 : 422,
          headers: { "Access-Control-Allow-Origin": "*" },
        })
      }
    }),
  })
  http.route({
    method: "OPTIONS",
    pathPrefix: "/storage-upload/",
    handler: httpAction(
      async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
    ),
  })
  http.route({
    method: "GET",
    pathPrefix: "/stored-files/",
    handler: httpAction(async (ctx, req) => {
      try {
        const payload = await verifyFileToken(
          new URL(req.url).pathname.slice("/stored-files/".length),
          "stored-file"
        )
        if (typeof payload.fileId !== "string")
          return new Response(null, { status: 404 })
        const url = await ctx.runAction(internal.storage.objects.url, {
          fileId: payload.fileId as Id<"storedFiles">,
          filename:
            typeof payload.filename === "string" ? payload.filename : undefined,
        })
        return url
          ? new Response(null, {
              status: 302,
              headers: { Location: url, "Cache-Control": "no-store" },
            })
          : new Response(null, { status: 404 })
      } catch {
        return new Response(null, { status: 404 })
      }
    }),
  })
}
