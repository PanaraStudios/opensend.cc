/** Bundled only into the Docker harness, never shipped with the dashboard. */
import { Registerer, RegistererState, UserAgent, type Invitation } from "sip.js"
import type { SessionDescriptionHandler } from "sip.js/lib/platform/web/index.js"

export interface BrowserAgentState {
  registered: boolean
  answered: boolean
  error?: string
  inboundPackets: number
  outboundPackets: number
}
export interface BrowserAgentHarness {
  state: BrowserAgentState
  start: (credential: { extension: string; password: string }) => Promise<void>
  dtmf: (digit: string) => void
  stats: () => Promise<BrowserAgentState>
  stop: () => Promise<void>
}
declare global {
  interface Window {
    agent: BrowserAgentHarness
  }
}
const state: BrowserAgentState = {
  registered: false,
  answered: false,
  inboundPackets: 0,
  outboundPackets: 0,
}
let userAgent: UserAgent,
  registerer: Registerer,
  invitation: Invitation | undefined
window.agent = {
  state,
  async start(credential) {
    state.registered = false
    state.error = undefined
    userAgent = new UserAgent({
      uri: UserAgent.makeURI(`sip:${credential.extension}@freeswitch`),
      authorizationUsername: credential.extension,
      authorizationPassword: credential.password,
      transportOptions: { server: "wss://freeswitch:7443" },
      logBuiltinEnabled: false,
      sessionDescriptionHandlerFactoryOptions: {
        constraints: { audio: true, video: false },
        peerConnectionConfiguration: { iceServers: [] },
      },
      delegate: {
        onInvite(incoming) {
          invitation = incoming
          void incoming
            .accept()
            .then(() => {
              state.answered = true
            })
            .catch((error: unknown) => {
              state.error =
                error instanceof Error ? error.message : "Answer failed"
            })
        },
      },
    })
    await userAgent.start()
    registerer = new Registerer(userAgent, { expires: 120 })
    registerer.stateChange.addListener((value) => {
      state.registered = value === RegistererState.Registered
    })
    await registerer.register({
      requestDelegate: {
        onReject(response) {
          state.error = `Registration rejected (${response.message.statusCode})`
        },
      },
    })
  },
  dtmf(digit) {
    const handler = invitation?.sessionDescriptionHandler as
      SessionDescriptionHandler | undefined
    if (!handler?.sendDtmf(digit)) throw new Error("RFC2833 sender unavailable")
  },
  async stats() {
    const handler = invitation?.sessionDescriptionHandler as
      SessionDescriptionHandler | undefined
    const report = await handler?.peerConnection?.getStats()
    report?.forEach((row) => {
      if (row.type === "inbound-rtp" && row.kind === "audio")
        state.inboundPackets = row.packetsReceived ?? 0
      if (row.type === "outbound-rtp" && row.kind === "audio")
        state.outboundPackets = row.packetsSent ?? 0
    })
    return { ...state }
  },
  async stop() {
    await registerer?.unregister()
    await userAgent?.stop()
  },
}
