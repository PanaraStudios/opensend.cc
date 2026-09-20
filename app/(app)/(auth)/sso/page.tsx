"use client"
import { AsyncForm, FormInput } from "@/components/auth/ui"
import { authClient, authResult } from "@/lib/auth/client"
import { useSearchParams } from "next/navigation"
import { authContinuation } from "@/lib/oauth/policy"
export default function Page() {
  const params = useSearchParams()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Sign in with SSO</h1>
      <p className="text-sm text-muted-foreground">
        For an existing account, connect SSO while signed in to Opensend first.
        Later sign-ins can use SSO directly.
      </p>
      <AsyncForm
        submitLabel="Continue"
        onSubmit={async (data) =>
          authResult(
            await authClient.signIn.oauth2({
              providerId: String(data.get("team")),
              callbackURL: authContinuation(params.get("next")),
            })
          )
        }
      >
        <FormInput name="team" label="Team ID" />
      </AsyncForm>
    </div>
  )
}
