"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

const PopoverName = React.createContext<{
  name: string
  setName: (name: string) => void
}>({ name: "", setName: () => {} })

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  const [name, setName] = React.useState("")
  return (
    <PopoverName.Provider value={{ name, setName }}>
      <PopoverPrimitive.Root data-slot="popover" {...props} />
    </PopoverName.Provider>
  )
}

function PopoverTrigger({ ref, ...props }: PopoverPrimitive.Trigger.Props) {
  const { setName } = React.useContext(PopoverName)
  const triggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (node) {
        const labelledBy = node
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim()
        setName(
          node.getAttribute("aria-label") ||
            labelledBy ||
            node.textContent?.trim() ||
            ""
        )
      }
      if (typeof ref === "function") return ref(node)
      if (ref) ref.current = node
    },
    [ref, setName]
  )
  return (
    <PopoverPrimitive.Trigger
      ref={triggerRef}
      data-slot="popover-trigger"
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) {
  const { name } = React.useContext(PopoverName)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-xl border border-border bg-popover p-2.5 text-sm text-popover-foreground shadow-float outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none motion-reduce:transition-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
          // A registered PopoverTitle's aria-labelledby takes precedence.
          aria-label={props["aria-label"] ?? (name || undefined)}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
