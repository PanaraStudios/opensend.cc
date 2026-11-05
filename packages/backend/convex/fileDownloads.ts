import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { env, type ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"
const key = () => new TextEncoder().encode(env.BETTER_AUTH_SECRET)

/** All attachment URLs are scoped, signed, and expire after one hour. */
export async function signedFileLink(
  ctx: Pick<ActionCtx, "runQuery">,
  prefix: string,
  audience: string,
  claims: JWTPayload
) {
  const installation = await ctx.runQuery(internal.installation.connection, {})
  return signedFileLinkForOrigin(
    installation.callbackOrigin ?? env.CONVEX_SITE_URL,
    prefix,
    audience,
    claims,
    Date.now()
  )
}

/** Mutations use the same signer with their installation origin and event time. */
export async function signedFileLinkForOrigin(
  origin: string,
  prefix: string,
  audience: string,
  claims: JWTPayload,
  now: number
) {
  const expires = Math.floor(now / 1000) + 3600
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setExpirationTime(expires)
    .sign(key())
  return {
    download_url: `${origin}${prefix}${token}`,
    expires_at: new Date(expires * 1000).toISOString(),
  }
}

export async function verifyFileToken(token: string, audience: string) {
  return (await jwtVerify(token, key(), { algorithms: ["HS256"], audience }))
    .payload
}
