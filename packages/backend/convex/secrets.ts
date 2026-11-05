import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { env } from "./_generated/server"

/* Secrets the installation stores for later use (webhook signing secrets,
   Meta app secrets and tokens) are encrypted with SSO_ENCRYPTION_KEY.
   better-auth/crypto needs no Node, so every runtime can use these. */
export const encryptSecret = (data: string) =>
  symmetricEncrypt({ key: env.SSO_ENCRYPTION_KEY, data })
export const decryptSecret = (data: string) =>
  symmetricDecrypt({ key: env.SSO_ENCRYPTION_KEY, data })
