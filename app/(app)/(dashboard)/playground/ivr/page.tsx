import type { Metadata } from "next"
import { PlaygroundComingSoon } from "@/components/dashboard/playground/coming-soon"

export const metadata: Metadata = { title: "IVR" }

export default function Page() {
  return <PlaygroundComingSoon tab="ivr" />
}
