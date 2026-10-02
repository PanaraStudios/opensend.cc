export const metadata: Metadata = { title: { absolute: "IVR · opensend.cc" } }
import type { Metadata } from "next"
import { IvrEditor } from "@/components/dashboard/playground/ivr"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <IvrEditor id={id} />
}
