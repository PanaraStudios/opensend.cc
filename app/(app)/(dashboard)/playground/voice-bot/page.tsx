export const metadata: Metadata = {
  title: { absolute: "Voice bots · opensend.cc" },
}
import type { Metadata } from "next"
import { VoiceBotList } from "@/components/dashboard/playground/voice-bots"

export default function Page() {
  return <VoiceBotList />
}
