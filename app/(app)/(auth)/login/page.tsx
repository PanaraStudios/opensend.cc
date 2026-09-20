import { redirect } from "next/navigation"

import { MARKETING_URL } from "@/lib/site"

export default function LoginPage() {
  redirect(`${MARKETING_URL}/waitlist`)
}
