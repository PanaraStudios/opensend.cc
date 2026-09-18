import type { Metadata } from "next"

import { FullScreenShell } from "@/components/dashboard/shell"

/* Its own route group so the editor gets the workspace store without the
   dashboard sidebar. Route groups do not change the URL, so `/broadcasts/[id]`
   keeps its dashboard chrome while `/broadcasts/[id]/edit` runs full screen. */
export const metadata: Metadata = {
  title: {
    default: "Editor",
    template: "%s · opensend.cc",
  },
  robots: { index: false, follow: false },
}

export default function EditorLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <FullScreenShell>{children}</FullScreenShell>
}
