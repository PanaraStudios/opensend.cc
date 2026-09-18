"use client"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  PALETTE_ITEMS,
  type PaletteItem,
} from "@/components/dashboard/broadcasts/editor/blocks"

/* Typing "/" in an empty text block opens the block catalogue right where the
   caret is. The trigger is a zero-size span so the popover anchors to the
   block without adding anything visible to the paper. */
export function SlashMenu({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (item: PaletteItem) => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 block size-0"
          />
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        className="w-64 p-0"
        data-testid="slash-menu"
      >
        <Command>
          <CommandInput placeholder="Search blocks…" autoFocus />
          <CommandList>
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup heading="Blocks">
              {PALETTE_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords}`}
                    data-testid={`slash-${item.id}`}
                    onSelect={() => onSelect(item)}
                  >
                    <Icon />
                    {item.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
