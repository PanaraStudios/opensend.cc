/* Invitation queries carry no clock, so they return expired rows too; the
   dashboard decides expiry against the browser clock. `now` is null while
   rendering on the server, where nothing is treated as expired yet. */
export function invitationExpired(
  invitation: { expiresAt: number },
  now: number | null
) {
  return now !== null && invitation.expiresAt <= now
}

export function liveInvitations<T extends { expiresAt: number }>(
  invitations: T[],
  now: number | null
) {
  return invitations.filter((i) => !invitationExpired(i, now))
}
