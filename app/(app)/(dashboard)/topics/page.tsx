import type { Metadata } from "next"

import { TopicsView } from "@/components/dashboard/topics"

export const metadata: Metadata = {
  title: "Topics",
}

export default function TopicsPage() {
  return <TopicsView />
}
