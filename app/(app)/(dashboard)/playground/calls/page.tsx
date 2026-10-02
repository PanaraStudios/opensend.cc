import type { Metadata } from "next"
import { CallsView } from "@/components/dashboard/calling/calls-view"
export const metadata: Metadata = { title: "Calls" }
export default function CallsPage() {
  return <CallsView />
}
