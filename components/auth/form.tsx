"use client"
import { authContinuation } from "@/lib/oauth/policy"
import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient, authResult } from "@/lib/auth/client"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  ArrowLeftIcon,
  Building2Icon,
  KeyRoundIcon,
  MailCheckIcon,
  SmartphoneIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field"
export type AuthMode =
  | "login"
  | "signup"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "mfa"
const titles: Record<AuthMode, string> = {
  login: "Welcome back",
  signup: "Create your account",
  "forgot-password": "Reset your password",
  "reset-password": "Choose a new password",
  "verify-email": "Verify your email",
  mfa: "Two-factor authentication",
}
function AuthTextLink({
  href,
  icon: Icon,
  children,
  size = "sm",
}: {
  href: string
  icon: LucideIcon
  children: React.ReactNode
  size?: "sm" | "xs"
}) {
  return (
    <Link href={href} className={buttonVariants({ variant: "ghost", size })}>
      <Icon data-icon="inline-start" />
      {children}
    </Link>
  )
}

function AuthNavigation({
  mode,
  nextQuery,
}: {
  mode: AuthMode
  nextQuery: string
}) {
  if (mode !== "login")
    return (
      <nav aria-label="Account options" className="flex justify-center">
        <AuthTextLink href={`/login${nextQuery}`} icon={ArrowLeftIcon}>
          Back to sign in
        </AuthTextLink>
      </nav>
    )
  return (
    <nav aria-label="Account options" className="flex flex-col gap-5">
      <div className="flex items-center gap-3" aria-hidden="true">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>
      <Link
        href={`/sso${nextQuery}`}
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        <Building2Icon data-icon="inline-start" />
        Continue with SSO
      </Link>
      <div className="flex flex-col items-center gap-1">
        <div className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
          <span>New to Opensend?</span>
          <AuthTextLink href={`/signup${nextQuery}`} icon={UserPlusIcon}>
            Create account
          </AuthTextLink>
        </div>
        <AuthTextLink
          href={`/verify-email${nextQuery}`}
          icon={MailCheckIcon}
          size="xs"
        >
          Resend verification email
        </AuthTextLink>
      </div>
    </nav>
  )
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const params = useSearchParams()
  const requestedNext = params.get("next")
  const returnTo = authContinuation(requestedNext)
  const nextQuery =
    returnTo !== "/emails" ? `?next=${encodeURIComponent(returnTo)}` : ""
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [backup, setBackup] = useState(false)
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setError("")
        setMessage("")
        const data = new FormData(event.currentTarget)
        const email = String(data.get("email") ?? "")
          .trim()
          .toLowerCase()
        const password = String(data.get("password") ?? "")
        try {
          if (mode === "login") {
            const result = await authResult(
              await authClient.signIn.email({
                email,
                password,
                callbackURL: returnTo,
              })
            )
            if (
              result &&
              "twoFactorRedirect" in result &&
              result.twoFactorRedirect
            )
              router.push(`/mfa${nextQuery}`)
            else {
              router.push(returnTo)
              router.refresh()
            }
          } else if (mode === "signup") {
            await authResult(
              await authClient.signUp.email({
                email,
                password,
                name: String(data.get("name")),
                callbackURL: `/login${nextQuery}`,
              })
            )
            setMessage(
              "Check the auth email log for your verification link, then sign in."
            )
          } else if (mode === "forgot-password") {
            await authResult(
              await authClient.requestPasswordReset({
                email,
                redirectTo: `/reset-password${nextQuery}`,
              })
            )
            setMessage("If this account exists, a reset link has been sent.")
          } else if (mode === "reset-password") {
            await authResult(
              await authClient.resetPassword({
                newPassword: password,
                token: params.get("token") ?? "",
              })
            )
            setMessage("Password reset. Sign in with your new password.")
          } else if (mode === "verify-email") {
            await authResult(
              await authClient.sendVerificationEmail({
                email,
                callbackURL: `/login${nextQuery}`,
              })
            )
            setMessage("Check your email for the verification link.")
          } else {
            const code = String(data.get("code") ?? "")
            await authResult(
              backup
                ? await authClient.twoFactor.verifyBackupCode({ code })
                : await authClient.twoFactor.verifyTotp({ code })
            )
            router.push(returnTo)
            router.refresh()
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please try again")
        } finally {
          setPending(false)
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{titles[mode]}</h1>
        {mode === "signup" && (
          <p className="text-sm text-muted-foreground">
            The first account sets up this instance. After that, you need a team
            invitation.
          </p>
        )}
      </div>
      <FieldGroup>
        {mode === "signup" && (
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
        )}
        {!["reset-password", "mfa"].includes(mode) && (
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </Field>
        )}
        {["login", "signup", "reset-password"].includes(mode) && (
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              {mode === "login" && (
                <AuthTextLink
                  href={`/forgot-password${nextQuery}`}
                  icon={KeyRoundIcon}
                  size="xs"
                >
                  Forgot password?
                </AuthTextLink>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={mode === "login" ? 1 : 12}
              required
            />
          </Field>
        )}
        {mode === "mfa" && (
          <Field>
            <FieldLabel htmlFor="code">
              {backup ? "Backup code" : "Authenticator code"}
            </FieldLabel>
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              required
            />
          </Field>
        )}
      </FieldGroup>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {params.get("error") && (
        <p role="alert" className="text-sm text-destructive">
          The link or sign-in attempt failed. Please try again.
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : "Continue"}
      </Button>
      {mode === "mfa" && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setBackup(!backup)}
        >
          {backup ? (
            <SmartphoneIcon data-icon="inline-start" />
          ) : (
            <KeyRoundIcon data-icon="inline-start" />
          )}
          {backup ? "Use authenticator" : "Use a backup code"}
        </Button>
      )}
      <AuthNavigation mode={mode} nextQuery={nextQuery} />
    </form>
  )
}
