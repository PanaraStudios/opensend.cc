export const metadata: Metadata = { title: { absolute: "Call · opensend.cc" } }
import type { Metadata } from "next"
import { PlaygroundCallDetail } from "@/components/dashboard/playground/call-detail"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PlaygroundCallDetail id={id} />
}
