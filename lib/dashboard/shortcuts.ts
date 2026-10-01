export type ShortcutKey = Pick<
  KeyboardEvent,
  | "key"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "isComposing"
  | "keyCode"
>

export function isMacPlatform(platform: string) {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function matchesShortcut(
  event: ShortcutKey,
  shortcut: string,
  mac: boolean
) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.altKey
  )
    return false
  const mod = shortcut.startsWith("mod+")
  const key = mod ? shortcut.slice(4) : shortcut
  if (event.metaKey !== (mod && mac) || event.ctrlKey !== (mod && !mac))
    return false
  // Shift is only meaningful for printable symbols, notably '?' on US keyboards.
  if (event.shiftKey && key !== "?") return false
  return event.key.toLowerCase() === key.toLowerCase()
}

export const SEQUENCE_TIMEOUT = 1000
export function sequenceKey(
  prefix: { key: string; at: number } | null,
  key: string,
  now: number
) {
  return prefix && now - prefix.at < SEQUENCE_TIMEOUT
    ? `${prefix.key} ${key}`
    : key
}

export const NAVIGATION_SHORTCUTS: Record<string, string> = {
  "/emails": "e",
  "/broadcasts": "b",
  "/automations": "a",
  "/templates": "t",
  "/contacts": "c",
  "/metrics": "m",
  "/domains": "d",
  "/channels": "h",
  "/logs": "l",
  "/api-keys": "k",
  "/webhooks": "w",
  "/settings/team": "s",
}

export function actionShortcut(action: string | null, label: string) {
  if (action === "create" && /^(Create|Add)\b/.test(label)) return "c"
  if (action === "edit" && /^Edit\b/.test(label)) return "e"
  if (action === "save" && /^Save\b/.test(label)) return "mod+s"
  if (action === "delete" && /^Delete\b/.test(label)) return "Backspace"
  return null
}
