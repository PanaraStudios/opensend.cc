/** Facebook Login for Business, using a configuration's code grant.
 * https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
 */
export const facebookLoginOptions = (configId: string) => ({
  config_id: configId,
  response_type: "code",
  override_default_response_type: true,
})
