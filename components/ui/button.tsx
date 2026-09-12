import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/* Copied from the "Button" node (SW-0) in the Reechlist Paper file: 32px tall, 10px radius,
   1px brand border, near-black gradient (near-white in dark mode), 14px/500 contrasting text
   with a 1px etched shadow, 16px Lucide icon, the ten-layer glass bevel.
   Press is scale(.97) over 160ms, hover dims to 90%.
   Sizes: xs 24 / sm 28 / default 32 / lg 36 / xl 40.
   `default` is the brand gradient with an etched text shadow. It keeps the bright light-mode
   bevel in dark mode too (shadow-glass-accent never switches, exactly as on the site);
   `secondary` is the same bevel and press, in the grey/white surface gradient;
   `outline` and `ghost` are flat. */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all ease-(--ease-press) outline-none select-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] active:transition-transform active:duration-(--dur-press) disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary-border bg-primary bg-(image:--gradient-primary) text-primary-foreground shadow-glass-accent [text-shadow:0_1px_1px_rgb(32_34_36/0.25)] hover:opacity-90 aria-expanded:opacity-90",
        secondary:
          "border-secondary-border bg-secondary bg-(image:--gradient-secondary) text-foreground shadow-glass hover:opacity-90 aria-expanded:opacity-90",
        outline:
          "border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-border-strong dark:bg-border-strong/30 dark:hover:bg-border-strong/50 dark:aria-expanded:bg-border-strong/50",
        ghost:
          "text-muted-foreground hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-destructive bg-destructive text-white shadow-glass-accent [text-shadow:0_1px_1px_rgb(32_34_36/0.25)] hover:opacity-90 focus-visible:outline-destructive",
        link: "h-auto rounded-none border-0 px-0 text-primary underline-offset-4 hover:text-primary-hover hover:underline",
      },
      size: {
        /* SW-0 in the Paper file: 32px tall, 10px radius, 12px sides (8px next to an icon), 6px gap */
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 has-[>svg:first-child:not(:only-child)]:pl-2 has-[>svg:last-child:not(:only-child)]:pr-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-[13px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 has-[>svg:first-child:not(:only-child)]:pl-1.5 has-[>svg:last-child:not(:only-child)]:pr-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 has-[>svg:first-child:not(:only-child)]:pl-2 has-[>svg:last-child:not(:only-child)]:pr-2",
        xl: "h-10 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 has-[>svg:first-child:not(:only-child)]:pl-2 has-[>svg:last-child:not(:only-child)]:pr-2",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
        "icon-xl": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
