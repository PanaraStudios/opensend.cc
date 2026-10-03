"use client"

import { useEffect, useRef } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/** The same settings content stacks into a sheet on narrow screens. */
export function FlowPanel({
  children,
  selection,
  open,
  onOpenChange,
  title = "Edit flow",
}: {
  children: React.ReactNode
  selection: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}) {
  const mobile = useIsMobile()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 })
  }, [selection])
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    )
  return (
    <aside
      ref={panel}
      aria-label="Flow editor"
      className="max-h-[78vh] min-w-0 overflow-y-auto border-l border-border"
    >
      {children}
    </aside>
  )
}
