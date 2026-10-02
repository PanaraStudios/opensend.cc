"use client"

import { BotIcon, WorkflowIcon } from "lucide-react"
import {
  DocsButton,
  EmptyState,
  SectionChrome,
} from "@/components/dashboard/primitives"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"

const PLACEHOLDERS = {
  ivr: {
    icon: WorkflowIcon,
    title: "IVR testing is coming soon",
    description: "Test the built-in IVR engine. Coming with the voice engine.",
  },
  "voice-bot": {
    icon: BotIcon,
    title: "Voice bot testing is coming soon",
    description: "Test the AI voice bot engine. Coming with the voice engine.",
  },
} as const

/** Icons are components, so the placeholder renders on the client: a server
    page can't pass a function prop to a client component. */
export function PlaygroundComingSoon({
  tab,
}: {
  tab: keyof typeof PLACEHOLDERS
}) {
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<DocsButton />}
    >
      <EmptyState {...PLACEHOLDERS[tab]} />
    </SectionChrome>
  )
}
