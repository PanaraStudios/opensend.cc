import Link from "next/link"

import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { FieldToast, ValidatedForm } from "@/components/ui/inline-toast"
import { Input } from "@/components/ui/input"

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  return (
    <ValidatedForm className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Forgot your password?</h1>
          <p className="text-sm text-balance text-muted-foreground">
            opensend.cc will send a reset link from your own SES domain.
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldToast
            messages={{
              valueMissing: "Enter your email",
              typeMismatch: "Enter a valid email",
            }}
          >
            <Input id="email" type="email" placeholder="you@yourdomain.com" required />
          </FieldToast>
        </Field>
        <Field>
          <Button type="submit">Send reset link</Button>
          <FieldDescription className="text-center">
            Remember your password?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Login
            </Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </ValidatedForm>
  )
}
