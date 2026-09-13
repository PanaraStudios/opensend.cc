import type { Metadata } from "next"

import { PropertiesView } from "@/components/dashboard/properties"

export const metadata: Metadata = {
  title: "Properties",
}

export default function PropertiesPage() {
  return <PropertiesView />
}
