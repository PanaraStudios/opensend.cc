import * as React from "react"
import { cn } from "cn"

/* Card, matched to reechlist.com. The card itself is the 14px "panel": a faint ink-cast
   gradient over the surface, a hairline ring and four stacked soft drops, 24px padding.
   Wrap it in <CardFrame> for the 18px outer shell with the 8px gutter (pricing tiers,
   testimonials). `highlight` flips the gradient so the cast sits at the bottom (featured tier). */
function Card({
  className,
  size = "default",
  hoverable = false,
  highlight = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  /** Ring darkens on hover. */
  hoverable?: boolean
  /** Reversed gradient with a 7% blue base, for the featured tier / selected item. */
  highlight?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-hoverable={hoverable || undefined}
      data-highlight={highlight || undefined}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card bg-(image:--gradient-panel) py-(--card-spacing) text-sm text-card-foreground shadow-panel transition-shadow [--card-spacing:--spacing(6)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-highlight:bg-(image:--gradient-panel-highlight) data-hoverable:hover:shadow-[0_0_0_1px_var(--border-strong),var(--shadow-panel)] data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

/* The 18px outer shell: 10% line with a 1px white glow outside, 8px gutter, backdrop blur. */
function CardFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-frame"
      className={cn(
        "rounded-[18px] border border-border-double p-2 shadow-[0_0_0_1px_var(--border-double-glow)] backdrop-blur-[8px] *:data-[slot=card]:h-full",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-h4 text-balance group-data-[size=sm]/card:text-base group-data-[size=sm]/card:leading-snug",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-pretty text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mt-auto flex items-center rounded-b-xl border-t border-border p-(--card-spacing) pt-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardFrame,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
