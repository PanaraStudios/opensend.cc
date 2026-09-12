import { siX, siYoutube } from "simple-icons"

import { cn } from "@/lib/utils"

/* Brand marks for the footer social row, inline from simple-icons (Lucide
   1.x ships none). Sized like a Lucide icon; inherit the current color. */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <path d={siX.path} />
    </svg>
  )
}

export function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <path d={siYoutube.path} />
    </svg>
  )
}
