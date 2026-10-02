export const metadata: Metadata = { title: { absolute: "IVR · opensend.cc" } }
import type { Metadata } from "next"
import { IvrEditor } from "@/components/dashboard/playground/ivr"
export default function Page() {
  return <IvrEditor />
}
