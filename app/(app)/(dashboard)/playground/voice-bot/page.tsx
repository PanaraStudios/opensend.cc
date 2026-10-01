import type { Metadata } from "next"
import { BotIcon } from "lucide-react"
import {
  DocsButton,
  EmptyState,
  SectionChrome,
} from "@/components/dashboard/primitives"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"

export const metadata: Metadata = { title: "Voice bot" }

export default function Page() {
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<DocsButton />}
    >
      <EmptyState
        icon={BotIcon}
        title="Voice bot testing is coming soon"
        description="Test the AI voice bot engine. Coming with the voice engine."
      />
    </SectionChrome>
  )
}
