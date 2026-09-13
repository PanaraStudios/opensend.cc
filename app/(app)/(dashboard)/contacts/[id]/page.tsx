import type { Metadata } from "next"

import { ContactDetail } from "@/components/dashboard/contacts"

export const metadata: Metadata = {
  title: "Contact",
}

export default function ContactDetailPage() {
  return <ContactDetail />
}
