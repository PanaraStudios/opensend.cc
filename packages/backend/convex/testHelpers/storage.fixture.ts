import type { TestConvex } from "convex-test"
import type { GenericDataModel, GenericDatabaseWriter } from "convex/server"
import type schema from "../schema"

/** Model a real upload receipt. convex-test's storeBlob omits contentType from
 * system metadata, so only this test fixture fills in the upload header. */
export async function storeUpload(t: TestConvex<typeof schema>, blob: Blob) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(blob)
    const db = ctx.db as GenericDatabaseWriter<GenericDataModel>
    await db.patch(storageId, { contentType: blob.type })
    return storageId
  })
}
