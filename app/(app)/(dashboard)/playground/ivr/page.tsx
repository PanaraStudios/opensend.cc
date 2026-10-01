import type { Metadata } from "next"
import { IvrList } from "@/components/dashboard/playground/ivr"
export const metadata: Metadata = { title: "IVR" }
export default function Page() {
  return <IvrList />
}
