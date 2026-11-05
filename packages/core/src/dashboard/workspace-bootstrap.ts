/** A revoked session can make installation fail while the account query settles.
 * Wait for that query's signed-out result; preserve errors for valid accounts.
 */
export function workspaceInstallation<T>(
  authenticated: boolean,
  account: unknown,
  result: T | Error | undefined
): T | undefined {
  if (!authenticated || account == null) return undefined
  if (result instanceof Error) throw result
  return result
}
