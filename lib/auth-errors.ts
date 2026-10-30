/** `/login?error=` code for an SSO sign-in that would have created a new
    account on a domain the installation has not approved. */
export const SSO_SIGNUP_REQUIRED = "sso_signup_required"

/** What the login page shows for its `error` query parameter. */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === SSO_SIGNUP_REQUIRED)
    return "SSO can create accounts only for approved email domains. Create your account with email and password, verify your email, then connect SSO while signed in."
  return "The link or sign-in attempt failed. Please try again."
}
