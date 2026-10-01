import type { Metadata } from "next"
import { VoiceBotList } from "@/components/dashboard/playground/voice-bots"
export const metadata: Metadata = { title: "Voice bot" }
export default function Page() { return <VoiceBotList /> }
