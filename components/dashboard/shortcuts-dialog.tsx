"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { DASHBOARD_NAV, CHANNEL_PAGES } from "@/lib/dashboard/nav"
import { NAVIGATION_SHORTCUTS } from "@/lib/dashboard/shortcuts"
import { useShortcutModifier } from "@/lib/dashboard/use-shortcut"

/** Keys pinned to the end of a row. The command-shortcut slot hides a
    command item's check icon, which would otherwise share the free space
    and stagger the keys. */
export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span
      data-slot="command-shortcut"
      className="ml-auto flex items-center gap-1"
    >
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  )
}

export function NavigationKeys({ href }: { href: string }) {
  const key = NAVIGATION_SHORTCUTS[href]
  return key ? <ShortcutKeys keys={["G", key.toUpperCase()]} /> : null
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mod = useShortcutModifier()
  const general = {
    title: "General",
    items: [
      ["Keyboard shortcuts", ["?"]],
      ["Command menu", [mod, "K"]],
      ["Toggle sidebar", [mod, "B"]],
      ["Toggle appearance", ["D"]],
      ["Confirm dialog", [mod, "Enter"]],
      ["Back to list / dismiss overlay", ["Esc"]],
    ],
  } as const
  const navigation = {
    title: "Navigation",
    items: [...DASHBOARD_NAV, ...CHANNEL_PAGES].map(
      (item) =>
        [
          item.title,
          ["G", NAVIGATION_SHORTCUTS[item.href].toUpperCase()],
        ] as const
    ),
  }
  const lists = {
    title: "Lists",
    items: [
      ["Focus search", ["/"]],
      ["Create or add", ["C"]],
      ["Next / previous row", ["J", "K"]],
      ["Open highlighted row", ["Enter"]],
      ["Toggle row selection", ["X"]],
      ["Select current page", [mod, "A"]],
      ["Delete selected rows", ["Backspace"]],
      ["Clear highlight and selection", ["Esc"]],
    ],
  } as const
  const editors = {
    title: "Editors",
    items: [
      ["Edit (where available)", ["E"]],
      ["Save (explicit Save action)", [mod, "S"]],
    ],
  } as const
  // Navigation is the long list, so it gets a column to itself and the
  // short groups stack beside it.
  const columns = [[general, lists, editors], [navigation]]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press G, then a letter or number to navigate. Shortcuts pause while
            typing or using a menu or dialog, except that dialog’s confirmation
            shortcut. Editors keep their own shortcuts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid items-start gap-6 sm:grid-cols-2">
          {columns.map((groups) => (
            <div key={groups[0].title} className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.title} className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">{group.title}</h3>
                  <dl className="flex flex-col gap-2">
                    {group.items.map(([label, keys]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="flex shrink-0 gap-1">
                          {keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
