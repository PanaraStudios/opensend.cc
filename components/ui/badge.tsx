import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/* Tag, matched to reechlist.com. `default` is the glass pill (translucent fill, sheen,
   soft bevel, 2px blur); `primary` is the solid blue gradient chip. 20px tall at 12px,
   `lg` is the 28px / 13px section eyebrow. Status tones carry a soft tint + colored text. */
const badgeVariants = cva(
  "group/badge relative inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-glass-soft bg-(image:--gradient-glass) text-foreground shadow-glass-soft backdrop-blur-[2px] duration-400 [text-shadow:none] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-(image:--gradient-bevel) before:content-[''] dark:backdrop-blur-[8px] [a&]:hover:opacity-95",
        primary:
          "border-primary-border bg-primary bg-(image:--gradient-primary) text-white shadow-glass-flat [a&]:hover:opacity-90",
        soft: "bg-primary-soft text-primary [a&]:hover:bg-selected",
        secondary:
          "border-border bg-muted text-muted-foreground [a&]:hover:text-foreground",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive: "bg-destructive-soft text-destructive",
        outline:
          "border-border bg-surface text-foreground [a&]:hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:text-primary-hover hover:underline",
      },
      size: {
        default: "h-5 px-2 text-xs",
        lg: "h-7 px-3 text-[13px] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2 [&>svg]:size-3.5!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function BadgeDot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge-dot"
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full bg-current", className)}
      {...props}
    />
  )
}

function Badge({
  className,
  variant = "default",
  size = "default",
  dot = false,
  children,
  render,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Prepend a 6px status dot in the current text color. */
    dot?: boolean
  }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
        children: dot ? (
          <>
            <BadgeDot />
            {children}
          </>
        ) : (
          children
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      size,
    },
  })
}

export { Badge, BadgeDot, badgeVariants }
