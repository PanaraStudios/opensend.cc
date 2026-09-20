import { redirect } from "next/navigation"

import { MARKETING_URL } from "@/lib/site"

export default function SignupPage() {
  redirect(`${MARKETING_URL}/waitlist`)
}
