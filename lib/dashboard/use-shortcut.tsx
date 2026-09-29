"use client"

import * as React from "react"
import { isMacPlatform, matchesShortcut, sequenceKey } from "./shortcuts"

type Binding = {
  keys: string
  run: (event: KeyboardEvent) => void | boolean
  scope?: React.RefObject<HTMLElement | null>
  priority?: number
}
type Registry = { bindings: Set<Binding>; mac: boolean }
const Shortcuts = React.createContext<Registry | null>(null)
export const ShortcutAction = React.createContext<string | null>(null)

export function isVisible(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
}

export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
    )
  )
}

const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]'

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [bindings] = React.useState(() => new Set<Binding>())
  const mac = React.useSyncExternalStore(
    () => () => {},
    () => isMacPlatform(navigator.platform),
    () => false
  )
  React.useEffect(() => {
    let prefix: { key: string; at: number } | null = null
    const reset = () => {
      prefix = null
    }
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat
      ) {
        reset()
        return
      }
      const overlays = Array.from(
        document.querySelectorAll<HTMLElement>(OVERLAYS)
      ).filter(isVisible)
      const typing = isTypingTarget(event.target)
      if (overlays.length || typing) reset()
      const ordered = [...bindings].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
      )
      const now = Date.now()
      const key = event.key.toLowerCase()
      const sequence = sequenceKey(prefix, key, now)
      reset()
      for (const binding of ordered) {
        const scope = binding.scope?.current
        if (binding.scope && (!scope || !isVisible(scope))) continue
        if (scope) {
          if (!(event.target instanceof Node) || !scope.contains(event.target))
            continue
          if (
            overlays.some(
              (overlay) => !overlay.contains(scope) && overlay !== scope
            )
          )
            continue
        } else if (typing || overlays.length) continue
        const match = binding.keys.includes(" ")
          ? sequence === binding.keys && matchesShortcut(event, key, mac)
          : sequence === key && matchesShortcut(event, binding.keys, mac)
        if (match && binding.run(event) !== false) {
          event.preventDefault()
          return
        }
      }
      if (!typing && !overlays.length && matchesShortcut(event, "g", mac)) {
        prefix = { key: "g", at: now }
        event.preventDefault()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("blur", reset)
    document.addEventListener("focusin", reset)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("blur", reset)
      document.removeEventListener("focusin", reset)
    }
  }, [bindings, mac])
  return (
    <Shortcuts.Provider
      value={React.useMemo(() => ({ bindings, mac }), [bindings, mac])}
    >
      {children}
    </Shortcuts.Provider>
  )
}

export function useShortcut(
  keys: string | null,
  run: Binding["run"],
  options: Omit<Binding, "keys" | "run"> & { enabled?: boolean } = {}
) {
  const registry = React.useContext(Shortcuts)
  const { enabled = true, scope, priority } = options
  React.useEffect(() => {
    if (!registry || !keys || !enabled) return
    const binding = { keys, run, scope, priority }
    registry.bindings.add(binding)
    return () => {
      registry.bindings.delete(binding)
    }
  }, [registry, keys, run, enabled, scope, priority])
}

export function useShortcutModifier() {
  return React.useContext(Shortcuts)?.mac ? "⌘" : "Ctrl"
}

export function useConfirmShortcut(open: boolean) {
  const scope = React.useRef<HTMLDivElement>(null)
  const button = React.useRef<HTMLButtonElement>(null)
  useShortcut(
    "mod+Enter",
    () => {
      if (!button.current || button.current.disabled) return false
      button.current.click()
    },
    { enabled: open, scope, priority: 100 }
  )
  return { scope, button }
}
