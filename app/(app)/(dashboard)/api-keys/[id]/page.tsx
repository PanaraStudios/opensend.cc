import type { Metadata } from "next"

import { ApiKeyDetail } from "@/components/dashboard/api-keys/detail"

export const metadata: Metadata = {
  title: "API key",
}

export default function ApiKeyDetailPage() {
  return <ApiKeyDetail />
}
