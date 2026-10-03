import { redirect } from "next/navigation"

import { EMAIL_CHANNELS_HREF } from "@/lib/dashboard/nav"

/** Domains are listed on the Channels page now. */
export default function LegacyDomainsPage() {
  redirect(EMAIL_CHANNELS_HREF)
}
