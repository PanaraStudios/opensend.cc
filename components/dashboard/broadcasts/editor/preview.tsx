"use client"

import { cn } from "@/lib/utils"

/* The preview runs in an iframe so the app's stylesheet never reaches the
   email, and so the email keeps its own colours in either app theme. */
export function EmailPreviewFrame({
  html,
  title,
  className,
  "data-testid": testId,
}: {
  html: string
  title: string
  className?: string
  "data-testid"?: string
}) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      data-testid={testId}
      className={cn("size-full border-0 bg-white", className)}
    />
  )
}
