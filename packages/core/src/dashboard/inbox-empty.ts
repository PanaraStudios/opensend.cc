export function inboxEmptyDescription(connected: boolean, filtered: boolean) {
  return filtered
    ? "No conversations match these filters. Clear the filters to see other conversations."
    : connected
      ? "Your channels are connected. Conversations appear here when someone messages you, or use Send message to start one."
      : "Connect a channel to receive messages and start conversations here."
}
