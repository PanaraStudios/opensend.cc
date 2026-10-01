import {
  parseIvr,
  type IvrAction,
  type IvrDefinition,
  type IvrMenu,
} from "../ivr"

export function newIvrMenu(id = "main"): IvrMenu {
  return {
    id,
    name: id === "main" ? "Main" : "New menu",
    prompt: { kind: "tts", text: "" },
    timeoutSeconds: 5,
    retries: 2,
    maxDigits: 1,
    options: {},
    noInputAction: { kind: "hangup" },
    failureAction: { kind: "hangup" },
  }
}
export function newIvr(): IvrDefinition {
  return {
    name: "",
    language: "en",
    entryMenuId: "main",
    menus: [newIvrMenu()],
  }
}
/** Strip resource metadata; both the form and REST use the shared definition. */
export function ivrFormPayload(value: IvrDefinition): IvrDefinition {
  return parseIvr({
    name: value.name,
    language: value.language,
    entryMenuId: value.entryMenuId,
    menus: value.menus,
    ...(value.promptVoice ? { promptVoice: value.promptVoice } : {}),
    ...(value.businessHours ? { businessHours: value.businessHours } : {}),
  })
}
export function ivrActionLabel(action: IvrAction | null | undefined): string {
  if (!action) return "—"
  switch (action.kind) {
    case "submenu":
      return `Menu: ${action.menuId}`
    case "bot":
      return `Bot: ${action.botId}`
    case "agents":
      return "Transfer to agents"
    case "voicemail":
      return "Voicemail"
    case "playAndHangup":
      return "Play and hang up"
    case "webhook":
      return "Webhook decision"
    case "hangup":
      return "Hang up"
  }
}
export function ivrPathSummary(
  path: readonly { menuId: string; digits: string }[]
) {
  return path.map((p) => `${p.menuId}: ${p.digits}`).join(" → ")
}
