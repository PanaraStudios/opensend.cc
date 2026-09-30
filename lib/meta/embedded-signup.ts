/* WhatsApp Embedded Signup v4 in the browser, as Meta documents it:
   https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/ */

/** Facebook's JavaScript SDK. */
export const FACEBOOK_SDK_URL = "https://connect.facebook.net/en_US/sdk.js"

/** `FB.login` options that open Embedded Signup and return a token code
    (exchangeable for 30 seconds) instead of a user token. */
export const signupLoginOptions = (configId: string) => ({
  config_id: configId,
  response_type: "code",
  override_default_response_type: true,
  extras: { setup: {} },
})

/** Only Facebook's own pages post signup events. */
export function isFacebookOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return (
      url.protocol === "https:" &&
      (url.hostname === "facebook.com" ||
        url.hostname.endsWith(".facebook.com"))
    )
  } catch {
    return false
  }
}

export type SignupMessage =
  | {
      type: "finish"
      wabaId: string
      businessId: string
      phoneNumberId?: string
    }
  | { type: "cancel"; step?: string }
  | { type: "error"; message: string }

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

/** Reads a `WA_EMBEDDED_SIGNUP` window message; anything else is null.
    FINISH and its variants carry the WABA, business and (usually) phone
    number IDs; CANCEL carries the step the person left at, or an error. */
export function readSignupMessage(raw: unknown): SignupMessage | null {
  let message: unknown = raw
  if (typeof raw === "string")
    try {
      message = JSON.parse(raw)
    } catch {
      return null
    }
  if (!message || typeof message !== "object") return null
  const { type, event, data } = message as Record<string, unknown>
  if (type !== "WA_EMBEDDED_SIGNUP") return null
  const fields =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {}
  const error = text(fields.error_message)
  if (event === "ERROR" || error)
    return { type: "error", message: error ?? "Meta could not finish signup" }
  if (event === "CANCEL")
    return { type: "cancel", step: text(fields.current_step) }
  if (typeof event === "string" && event.startsWith("FINISH")) {
    const wabaId = text(fields.waba_id)
    const businessId = text(fields.business_id)
    if (!wabaId || !businessId) return null
    return {
      type: "finish",
      wabaId,
      businessId,
      phoneNumberId: text(fields.phone_number_id),
    }
  }
  return null
}
