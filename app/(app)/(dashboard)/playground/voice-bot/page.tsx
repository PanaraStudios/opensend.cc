import type { Metadata } from "next"
import { PlaygroundComingSoon } from "@/components/dashboard/playground/coming-soon"

export const metadata: Metadata = { title: "Voice bot" }

export default function Page() {
  return <PlaygroundComingSoon tab="voice-bot" />
}
