import {
  menuActions,
  parseIvr,
  type IvrAction,
  type IvrDefinition,
  type IvrMenu,
} from "../ivr"
import { pickerSelectedIds } from "./options"
import { codeLabel } from "./format"

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
/** Voice bots an IVR graph must name, capped to the picker point-read limit. */
export function ivrReferencedBotIds(definition: IvrDefinition): string[] {
  const ids: string[] = []
  const consider = (action: IvrAction | null | undefined) => {
    if (action?.kind === "bot" && action.botId) ids.push(action.botId)
  }
  for (const menu of definition.menus)
    for (const action of menuActions(menu)) consider(action)
  consider(definition.businessHours?.closedAction)
  return pickerSelectedIds(ids)
}

export function ivrActionLabel(
  action: IvrAction | null | undefined,
  menus?: readonly { id: string; name: string }[]
): string {
  if (!action) return "—"
  switch (action.kind) {
    case "submenu": {
      const name = menus?.find((menu) => menu.id === action.menuId)?.name
      return name ? `Menu: ${name}` : "Submenu"
    }
    case "bot":
      return "Voice bot"
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

/** Explicit null clears optional settings on a REST PATCH instead of retaining the saved value. */
export function ivrFormPatch(value: IvrDefinition) {
  const definition = ivrFormPayload(value)
  return {
    ...definition,
    promptVoice: definition.promptVoice ?? null,
    businessHours: definition.businessHours ?? null,
  }
}

export function callOutcomeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    completed: "Completed",
    transferred_agent: "Transferred to agent",
    transferred_ivr: "Transferred to IVR",
    ended_by_bot: "Ended by bot",
    caller_hangup: "Caller hung up",
    failed: "Failed",
    budget_exhausted: "Minute limit reached",
    queued: "Queued",
    ringing: "Ringing",
    connected: "In progress",
    answered: "Answered",
    rejected: "Rejected",
    missed: "Missed",
    busy: "Busy",
    no_answer: "No answer",
  }
  return value ? (labels[value] ?? "Ended") : "In progress"
}

const CALL_PERMISSION_LABELS: Record<string, string> = {
  no_permission: "No permission",
  temporary: "Temporary",
  permanent: "Permanent",
  granted: "Granted",
  pending: "Pending",
  denied: "Denied",
  expired: "Expired",
}

/** How a call was handled, without a blank name or a raw bot id. */
export function callRouteLabel(
  call: {
    bot_id?: string | null
    bot_name?: string | null
    ivr_id?: string | null
    handling_mode?: string | null
  },
  ivrs?: readonly { id: string; name: string }[]
) {
  if (call.bot_id) return call.bot_name ? `Bot ${call.bot_name}` : "Voice bot"
  if (call.ivr_id) {
    const name = ivrs?.find((ivr) => ivr.id === call.ivr_id)?.name
    return name ? `IVR ${name}` : "IVR"
  }
  return call.handling_mode === "api" ? "API" : "Agent"
}

/** A contact's accept or reject of a call permission request. */
export function callPermissionReplyLabel(response: string | null | undefined) {
  if (response === "accept") return "Accepted"
  if (response === "reject") return "Declined"
  return codeLabel(response ?? "")
}

/** WhatsApp calling permission, never the stored code. */
export function callPermissionLabel(status: string | null | undefined) {
  if (!status || status === "unknown") return "Not checked"
  return (
    CALL_PERMISSION_LABELS[status] ??
    status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase())
  )
}

/** Rename a menu and all incoming references together; IDs are never user inputs. */
export function renameIvrMenu(
  definition: IvrDefinition,
  oldId: string,
  name: string
): IvrDefinition {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "menu"
  const taken = new Set(
    definition.menus.filter((m) => m.id !== oldId).map((m) => m.id)
  )
  let id = base,
    n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  const redirect = (a: IvrAction): IvrAction =>
    a.kind === "submenu" && a.menuId === oldId ? { ...a, menuId: id } : a
  return {
    ...definition,
    entryMenuId: definition.entryMenuId === oldId ? id : definition.entryMenuId,
    menus: definition.menus.map((m) => ({
      ...m,
      ...(m.id === oldId ? { id, name } : {}),
      options: Object.fromEntries(
        Object.entries(m.options).map(([key, a]) => [key, redirect(a)])
      ),
      noInputAction: redirect(m.noInputAction),
      failureAction: redirect(m.failureAction),
    })),
    ...(definition.businessHours
      ? {
          businessHours: {
            ...definition.businessHours,
            closedAction: redirect(definition.businessHours.closedAction),
          },
        }
      : {}),
  }
}
