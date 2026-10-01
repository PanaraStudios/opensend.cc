import { env } from "../_generated/server"

export function objectStorageConfig() {
  const bucket = env.OBJECT_STORAGE_BUCKET
  if (!bucket) return null
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey)
    throw new Error("Object storage credentials are incomplete")
  return {
    bucket,
    endpoint: env.OBJECT_STORAGE_ENDPOINT || undefined,
    region: env.OBJECT_STORAGE_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
  }
}
/** Explicitly public assets only; R2 presigned URLs require the S3 endpoint. */
export function publicAssetUrl(key: string) {
  if (!env.OBJECT_STORAGE_PUBLIC_BASE_URL) return null
  const base = new URL(env.OBJECT_STORAGE_PUBLIC_BASE_URL)
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Public storage base URL must be HTTPS")
  return `${base.href.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`
}
