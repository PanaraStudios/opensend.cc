export const metadata: Metadata = {
  title: { absolute: "Voice bot · opensend.cc" },
}
import type { Metadata } from "next"
import { VoiceBotEditor } from "@/components/dashboard/playground/voice-bots"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <VoiceBotEditor id={id} />
}
