/** Facebook Login for Business with a configuration, letting Meta pick the
 * response. A "User access token" configuration returns a user token; its
 * codes are bound to the SDK's hidden redirect URI and cannot be exchanged
 * server-side. A "System-user access token" configuration returns a code.
 * https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
 */
export const facebookLoginOptions = (configId: string) => ({
  config_id: configId,
})

/** The code grant, which Embedded Signup always uses. */
export const codeLoginOptions = (configId: string) => ({
  config_id: configId,
  response_type: "code",
  override_default_response_type: true,
})
