import type { Metadata } from "next"
import { ProviderKeys } from "@/components/dashboard/playground/provider-keys"
export const metadata: Metadata = {
  title: { absolute: "AI providers · opensend.cc" },
}
export default function Page() {
  return <ProviderKeys />
}
