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

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  return (
    <ValidatedForm className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Log in to opensend.cc</h1>
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
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              href="/forgot-password"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
          <FieldToast messages={{ valueMissing: "Enter your password" }}>
            <Input id="password" type="password" required />
          </FieldToast>
        </Field>
        <Field>
          <Button type="submit">Log in</Button>
        </Field>
        <FieldSeparator>Or continue with</FieldSeparator>
        <Field>
          <Button variant="outline" type="button">
            <GitHubIcon />
            Log in with GitHub
          </Button>
          <FieldDescription className="text-center">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Sign up
            </Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </ValidatedForm>
  )
}
