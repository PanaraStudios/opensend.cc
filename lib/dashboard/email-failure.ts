/** Plain-language SES send failures, shared by every dashboard outcome. */
export function emailFailureMessage(reason: string): string {
  if (
    /invalid.*credentials|InvalidClientTokenId|UnrecognizedClient|SignatureDoesNotMatch|ExpiredToken|CredentialsProviderError|security token.*invalid/i.test(
      reason
    )
  )
    return "AWS credentials are invalid or expired. Ask your instance administrator to update the AWS connection in Amazon SES settings."
  if (/sandbox|not verified|notverified|identity.*verif/i.test(reason))
    return "Amazon SES could not send to an unverified address. Verify the sender and recipient in the sending region, or ask your instance administrator to request production access."
  if (/throttl|TooManyRequests|quota.*exceed|daily.*quota/i.test(reason))
    return "Amazon SES reached its sending limit. Wait before trying again, or ask your instance administrator to increase the sending quota."
  if (/suppress/i.test(reason))
    return "This recipient is suppressed after a bounce, complaint, or unsubscribe. Check the recipient’s suppression and subscription status before sending again."
  if (/MessageRejected|message.*reject/i.test(reason))
    return "Amazon SES rejected this email. Check the provider message for the cause and correct the email before sending again."
  if (/AWS operation failed/i.test(reason))
    return "Amazon SES could not send this email. Ask your instance administrator to check the AWS connection."
  return reason
}
