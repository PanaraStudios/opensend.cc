import type { Metadata } from "next"

import { ApiKeysView } from "@/components/dashboard/api-keys/list"

export const metadata: Metadata = {
  title: "API keys",
}

export default function ApiKeysPage() {
  return <ApiKeysView />
}
