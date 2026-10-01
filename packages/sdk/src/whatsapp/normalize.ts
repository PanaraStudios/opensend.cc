import {
  WHATSAPP_RECEIVE_TYPES,
  type WhatsAppNormalized,
  type WhatsAppIdentity,
} from "./catalog"
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
/** Additive normalized fields; raw always retains the unmodified Meta object. */
export function normalizeWhatsAppMessage(
  raw: Record<string, unknown>,
  identity: WhatsAppIdentity = {}
): WhatsAppNormalized {
  const wireType = typeof raw.type === "string" ? raw.type : "unsupported"
  const type =
    WHATSAPP_RECEIVE_TYPES.find((t) => t === wireType) ?? "unsupported"
  let content: unknown =
    raw[type] ?? (type === "unsupported" ? { type: wireType } : {})
  if (type === "interactive") {
    const interactive = object(content)
    if (interactive.type === "nfm_reply") {
      try {
        content = {
          ...interactive,
          response: JSON.parse(
            String(object(interactive.nfm_reply).response_json)
          ),
        }
      } catch {
        /* Keep malformed response_json verbatim. */
      }
    }
  }
  return {
    type,
    content,
    raw,
    identity: {
      ...identity,
      ...(typeof raw.to === "string" ? { wa_id: raw.to } : {}),
      ...(typeof raw.recipient === "string" ? { user_id: raw.recipient } : {}),
      ...(typeof raw.from === "string" ? { wa_id: raw.from } : {}),
      ...(typeof raw.from_user_id === "string"
        ? { user_id: raw.from_user_id }
        : {}),
      ...(typeof raw.from_parent_user_id === "string"
        ? { parent_user_id: raw.from_parent_user_id }
        : {}),
    },
    ...(raw.context ? { context: raw.context } : {}),
    ...(raw.referral ? { referral: raw.referral } : {}),
    ...(raw.errors ? { errors: raw.errors } : {}),
  } as WhatsAppNormalized
}
