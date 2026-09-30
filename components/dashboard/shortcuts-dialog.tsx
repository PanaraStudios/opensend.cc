"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { DASHBOARD_NAV } from "@/lib/dashboard/nav"
import { NAVIGATION_SHORTCUTS } from "@/lib/dashboard/shortcuts"
import { useShortcutModifier } from "@/lib/dashboard/use-shortcut"

export function NavigationKeys({ href }: { href: string }) {
  const key = NAVIGATION_SHORTCUTS[href]
  return key ? (
    <span className="ml-auto flex items-center gap-1">
      <Kbd>G</Kbd>
      <Kbd>{key.toUpperCase()}</Kbd>
    </span>
  ) : null
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mod = useShortcutModifier()
  const groups = [
    {
      title: "General",
      items: [
        ["Keyboard shortcuts", ["?"]],
        ["Command menu", [mod, "K"]],
        ["Toggle sidebar", [mod, "B"]],
        ["Toggle appearance", ["D"]],
        ["Confirm dialog", [mod, "Enter"]],
        ["Back to list / dismiss overlay", ["Esc"]],
      ],
    },
    {
      title: "Navigation",
      items: DASHBOARD_NAV.map(
        (item) =>
          [
            item.title,
            ["G", NAVIGATION_SHORTCUTS[item.href].toUpperCase()],
          ] as const
      ),
    },
    {
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
    },
    {
      title: "Editors",
      items: [
        ["Edit (where available)", ["E"]],
        ["Save (explicit Save action)", [mod, "S"]],
      ],
    },
  ] as const
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press G, then a letter to navigate. Shortcuts pause while typing or
            using a menu or dialog, except that dialog’s confirmation shortcut.
            Editors keep their own shortcuts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
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
      </DialogContent>
    </Dialog>
  )
}
