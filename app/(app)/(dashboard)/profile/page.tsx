import type { Metadata } from "next"

import { Profile } from "@/components/dashboard/profile"

export const metadata: Metadata = {
  title: "Profile",
}

export default function ProfilePage() {
  return <Profile />
}
