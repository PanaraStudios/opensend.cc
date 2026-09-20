import { Suspense } from "react"
import { OAuthConsent } from "@/components/auth/oauth-consent"
export default function Page() {
  return (
    <Suspense>
      <OAuthConsent />
    </Suspense>
  )
}
