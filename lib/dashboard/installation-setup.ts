export const SETUP_STEPS = [
  "welcome",
  "aws",
  "callback",
  "resources",
  "team",
  "domain",
] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** The same saved wizard can follow either the email or Meta-only path. */
export const setupSteps = (emailDeferred: boolean) =>
  SETUP_STEPS.filter(
    (step) => !emailDeferred || (step !== "resources" && step !== "domain")
  )

export function inferredSetupStep(
  installation:
    | {
        accountId?: string
        emailDeferredAt?: number
        environmentCheckedAt?: number
      }
    | null
    | undefined,
  regionsReady: boolean,
  hasTeam: boolean
): SetupStep {
  if (installation?.emailDeferredAt)
    return installation.environmentCheckedAt ? "team" : "callback"
  if (!installation?.accountId) return "welcome"
  if (!installation.environmentCheckedAt) return "callback"
  if (!regionsReady) return "resources"
  return hasTeam ? "domain" : "team"
}
