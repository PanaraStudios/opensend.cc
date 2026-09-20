import { cn } from "@/lib/utils"

export type LogoVariant = "full" | "mark"
export type LogoTheme = "auto" | "light" | "dark"

export type LogoProps = {
  className?: string
  /** `full` is the @ + opensend.cc lockup. `mark` is the @ alone. */
  variant?: LogoVariant
  /**
   * `auto` follows the page theme via `currentColor`.
   * `light` / `dark` force ink for a known background (OG, dark panels).
   */
  theme?: LogoTheme
}

const themeClass = {
  auto: "text-foreground",
  light: "text-black",
  dark: "text-white",
} as const

/** @ paths in a 32×32 viewBox. Stroke 2.7, round caps — matches the source lockup. */
export const LOGO_MARK_VIEWBOX = "0 0 32 32"
export const LOGO_MARK_STROKE = 2.7
export const LOGO_MARK_BOWL = { cx: 15.15, cy: 14.2, r: 3.65 } as const
export const LOGO_MARK_TAIL =
  "M18.8 10.5V18.15C18.8 21.55 16.55 24.35 12.85 24.35C7.85 24.35 5.15 20.35 5.15 14.7C5.15 8.85 9.45 4.7 15.35 4.7C21.25 4.7 25.5 9 25.5 15.1C25.5 17.85 24.35 20.05 22.15 21.35"

function AtPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={LOGO_MARK_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle
        cx={LOGO_MARK_BOWL.cx}
        cy={LOGO_MARK_BOWL.cy}
        r={LOGO_MARK_BOWL.r}
      />
      <path d={LOGO_MARK_TAIL} />
    </g>
  )
}

export function LogoMark({
  className,
  theme = "auto",
  decorative = false,
}: {
  className?: string
  theme?: LogoTheme
  /** Hide from AT when the wordmark sits beside it. */
  decorative?: boolean
}) {
  return (
    <svg
      viewBox={LOGO_MARK_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block size-[1em] shrink-0", themeClass[theme], className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "opensend.cc"}
    >
      {decorative ? null : <title>opensend.cc</title>}
      <AtPaths />
    </svg>
  )
}

/**
 * opensend.cc lockup: the @ mark, or @ + opensend.cc.
 * Size follows `em` (`text-base`, `size-6`, …). Ink follows theme.
 */
export function Logo({
  className,
  variant = "full",
  theme = "auto",
}: LogoProps) {
  if (variant === "mark") {
    return <LogoMark className={className} theme={theme} />
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.28em] font-sans font-semibold tracking-tight",
        themeClass[theme],
        className
      )}
    >
      <LogoMark theme={theme} decorative className="size-[1.22em]" />
      <span className="leading-none">opensend.cc</span>
    </span>
  )
}
