export type InstallationChannels = { email?: boolean; meta?: boolean }
export type SetupState = {
  setupStep?: SetupStep
  channels?: InstallationChannels
  accountId?: string
  emailDeferredAt?: number
  metaDeferredAt?: number
  environmentCheckedAt?: number
}
export const SETUP_STEPS = [
  "welcome",
  "channels",
  "callback",
  "aws",
  "resources",
  "meta",
  "team",
  "domain",
] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** Documents created before channel selection retain their saved email flow. */
export const emailSetupRequired = (state: SetupState) =>
  (state.channels?.email ?? !state.channels) && !state.emailDeferredAt
export const metaSetupRequired = (state: SetupState) =>
  !!state.channels?.meta && !state.metaDeferredAt

export function setupSteps(state: SetupState): SetupStep[] {
  if (
    !state.channels &&
    !state.accountId &&
    !state.emailDeferredAt &&
    (!state.setupStep || ["welcome", "channels"].includes(state.setupStep))
  )
    return ["welcome", "channels", "callback", "team"]
  if (!state.channels)
    return [
      "welcome",
      "aws",
      "callback",
      ...(state.emailDeferredAt ? [] : ["resources" as const]),
      "team",
      ...(state.emailDeferredAt ? [] : ["domain" as const]),
    ]
  return SETUP_STEPS.filter((step) => {
    if (step === "aws") return !!state.channels?.email
    if (step === "resources" || step === "domain")
      return emailSetupRequired(state)
    if (step === "meta") return !!state.channels?.meta
    return true
  })
}
export const nextSetupStep = (state: SetupState, step: SetupStep) => {
  const steps = setupSteps(state)
  return steps[steps.indexOf(step) + 1] ?? step
}
export function inferredSetupStep(
  installation: SetupState | null | undefined,
  regionsReady: boolean,
  hasTeam: boolean,
  metaReady = false
): SetupStep {
  if (!installation) return "welcome"
  if (installation.channels) {
    if (!installation.environmentCheckedAt) return "callback"
    if (emailSetupRequired(installation)) {
      if (!installation.accountId) return "aws"
      if (!regionsReady) return "resources"
    }
    if (metaSetupRequired(installation) && !metaReady) return "meta"
    return hasTeam && emailSetupRequired(installation) ? "domain" : "team"
  }
  if (installation.emailDeferredAt)
    return installation.environmentCheckedAt ? "team" : "callback"
  if (!installation.accountId) return "welcome"
  if (!installation.environmentCheckedAt) return "callback"
  if (!regionsReady) return "resources"
  return hasTeam ? "domain" : "team"
}
