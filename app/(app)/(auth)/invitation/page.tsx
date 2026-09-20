import { Suspense } from "react"
import { Invitation } from "@/components/auth/invitation"
export default function Page() {
  return (
    <Suspense>
      <Invitation />
    </Suspense>
  )
}
