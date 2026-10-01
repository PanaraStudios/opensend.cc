export type CallState =
  "route" | "ivr" | "bot" | "agent" | "voicemail" | "hangup"

/** Only the controller can choose destinations. Hangup is terminal. */
export class CallStateMachine {
  state: CallState = "route"
  private serial: Promise<unknown> = Promise.resolve()
  transition(next: CallState, effect: () => Promise<void>) {
    const operation = this.serial.then(async () => {
      if (this.state === "hangup") throw new Error("Call is terminal")
      if (next === "route") throw new Error("Cannot return to route")
      await effect()
      // A concurrent remote hangup must never be overwritten by a slow effect.
      if ((this.state as CallState) !== "hangup") this.state = next
    })
    this.serial = operation.catch(() => undefined)
    return operation
  }
  end() {
    this.state = "hangup"
  }
}
