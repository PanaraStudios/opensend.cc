import Link from "next/link"

import { cn } from "cn"

import { GitHubIcon } from "@/components/brand-icons"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { FieldToast, ValidatedForm } from "@/components/ui/inline-toast"
import { Input } from "@/components/ui/input"

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  return (
    <ValidatedForm className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Create your opensend.cc account</h1>
        </div>
        <Field>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <FieldToast messages={{ valueMissing: "Enter your name" }}>
            <Input
              id="name"
              type="text"
              placeholder="Ada Lovelace"
              required
              className="bg-background"
            />
          </FieldToast>
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldToast
            messages={{
              valueMissing: "Enter your email",
              typeMismatch: "Enter a valid email",
            }}
          >
            <Input
              id="email"
              type="email"
              placeholder="you@yourdomain.com"
              required
              className="bg-background"
            />
          </FieldToast>
          <FieldDescription>
            This stays on your server.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldToast
            messages={{
              valueMissing: "Enter your password",
              tooShort: "Use at least 8 characters",
            }}
          >
            <Input
              id="password"
              type="password"
              minLength={8}
              required
              className="bg-background"
            />
          </FieldToast>
          <FieldDescription>
            At least 8 characters.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <FieldToast messages={{ valueMissing: "Confirm your password" }}>
            <Input
              id="confirm-password"
              type="password"
              required
              className="bg-background"
            />
          </FieldToast>
        </Field>
        <Field>
          <Button type="submit">Create account</Button>
        </Field>
        <FieldSeparator>Or continue with</FieldSeparator>
        <Field>
          <Button variant="outline" type="button">
            <GitHubIcon />
            Sign up with GitHub
          </Button>
          <FieldDescription className="px-6 text-center">
            Already have an account? <Link href="/login">Sign in</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </ValidatedForm>
  )
}
