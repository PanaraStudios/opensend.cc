import type { Metadata } from "next"

import { TopicsView } from "@/components/dashboard/audience/topics"

export const metadata: Metadata = {
  title: "Topics",
}

export default function TopicsPage() {
  return <TopicsView />
}
