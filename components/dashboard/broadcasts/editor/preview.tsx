"use client"

import { cn } from "@/lib/utils"

/* The preview runs in an iframe so the app's stylesheet never reaches the
   email, and so the email keeps its own colours in either app theme. The
   sandbox is fully closed: nothing in a preview — least of all markup pasted
   into HTML mode — has any reason to run script or reach back out. */
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
      sandbox=""
      data-testid={testId}
      className={cn("size-full border-0 bg-white", className)}
    />
  )
}
