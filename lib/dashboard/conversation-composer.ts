import type { WhatsAppInteractive } from "../../packages/sdk/src/whatsapp/catalog"
export const INTERACTIVE_ITEMS = [
  { value: "button", label: "Reply buttons" },
  { value: "list", label: "List" },
  { value: "cta_url", label: "CTA URL" },
  { value: "location_request_message", label: "Location request" },
] as const
export type InteractiveKind = (typeof INTERACTIVE_ITEMS)[number]["value"]
/** Produces the SDK's typed shape; the send pipeline applies the API validation. */
export function composerInteractive(input: {
  kind: InteractiveKind
  body: string
  header: string
  footer: string
  labels: string[]
  button: string
  url: string
}): WhatsAppInteractive {
  const shared = {
    body: { text: input.body },
    ...(input.header
      ? { header: { type: "text" as const, text: input.header } }
      : {}),
    ...(input.footer ? { footer: { text: input.footer } } : {}),
  }
  switch (input.kind) {
    case "button":
      return {
        ...shared,
        type: "button",
        action: {
          buttons: input.labels
            .filter((label) => label.trim())
            .map((label, i) => ({
              type: "reply",
              reply: { id: `reply-${i + 1}`, title: label },
            })),
        },
      }
    case "list":
      return {
        ...shared,
        type: "list",
        action: {
          button: input.button,
          sections: [
            {
              title: "Options",
              rows: input.labels
                .filter((label) => label.trim())
                .map((label, i) => ({ id: `option-${i + 1}`, title: label })),
            },
          ],
        },
      }
    case "cta_url":
      return {
        ...shared,
        type: "cta_url",
        action: {
          name: "cta_url",
          parameters: { display_text: input.button, url: input.url },
        },
      }
    case "location_request_message":
      return {
        type: "location_request_message",
        body: { text: input.body },
        action: { name: "send_location" },
      }
  }
}
