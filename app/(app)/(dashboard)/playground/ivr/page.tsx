import type { Metadata } from "next"
import { WorkflowIcon } from "lucide-react"
import {
  DocsButton,
  EmptyState,
  SectionChrome,
} from "@/components/dashboard/primitives"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"

export const metadata: Metadata = { title: "IVR" }

export default function Page() {
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<DocsButton />}
    >
      <EmptyState
        icon={WorkflowIcon}
        title="IVR testing is coming soon"
        description="Test the built-in IVR engine. Coming with the voice engine."
      />
    </SectionChrome>
  )
}
