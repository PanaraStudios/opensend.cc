import type { Metadata } from "next"

import { ContactDetail } from "@/components/dashboard/audience/contact-detail"

export const metadata: Metadata = {
  title: "Contact",
}

export default function ContactDetailPage() {
  return <ContactDetail />
}
