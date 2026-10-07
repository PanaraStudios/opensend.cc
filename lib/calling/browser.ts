import type { SimpleUser } from "sip.js/lib/platform/web"
import { browserIceServers, type IceConfiguration } from "./ice"
import { isDtmf } from "../meta/softphone"
export interface BrowserCredential {
  wssUrl: string
  extension: string
  password: string
}
/** One WebRTC agent leg. Graph/Janus signaling stays entirely on the backend. */
export class BrowserPhone {
  private user?: SimpleUser
  private disposed = false
  private ice?: IceConfiguration
  setIceConfiguration(configuration: IceConfiguration) {
    this.ice = configuration
  }
  private microphoneId = "default"
  setMicrophone(id: string) {
    this.microphoneId = id
  }
  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly events: {
      invite: () => Promise<boolean>
      connected: () => void
      ended: () => void
      failed: (error: unknown) => void
    }
  ) {}
  async register(
    credential: BrowserCredential,
    configuration?: IceConfiguration
  ) {
    const { SimpleUser, defaultSessionDescriptionHandlerFactory } =
      await import("sip.js/lib/platform/web")
    if (this.disposed) throw new Error("Softphone closed")
    this.ice = configuration
    const factory = defaultSessionDescriptionHandlerFactory(
      async (constraints) =>
        navigator.mediaDevices.getUserMedia({
          ...constraints,
          audio:
            this.microphoneId === "default"
              ? true
              : { deviceId: { exact: this.microphoneId } },
        })
    )
    let registered!: () => void
    const ready = new Promise<void>((resolve) => {
      registered = resolve
    })
    const user = (this.user = new SimpleUser(credential.wssUrl, {
      aor: `sip:${credential.extension}@freeswitch`,
      registererOptions: { expires: 120 },
      reconnectionAttempts: 0,
      media: {
        constraints: { audio: true, video: false },
        remote: { audio: this.audio },
      },
      sendDTMFUsingSessionDescriptionHandler: true,
      userAgentOptions: {
        authorizationUsername: credential.extension,
        authorizationPassword: credential.password,
        logBuiltinEnabled: false,
        logConfiguration: false,
        // Read the current credentials for each new call, including after refresh.
        sessionDescriptionHandlerFactory: (session, options) =>
          factory(session, {
            ...options,
            peerConnectionConfiguration: {
              iceServers: browserIceServers(this.ice),
            },
          }),
      },
      delegate: {
        onRegistered: registered,
        onUnregistered: () => {
          if (!this.disposed)
            this.events.failed(new Error("SIP registration expired"))
        },
        onServerDisconnect: () => {
          if (!this.disposed)
            this.events.failed(new Error("Calling gateway disconnected"))
        },
        onCallReceived: () => {
          void (async () => {
            if (this.disposed || !(await this.events.invite())) {
              await user.decline()
              return
            }
            await user.answer()
          })().catch(this.events.failed)
        },
        onCallAnswered: () => {
          void this.audio.play().catch(this.events.failed)
          this.events.connected()
        },
        onCallHangup: () => {
          this.stopTracks()
          this.events.ended()
        },
      },
    }))
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await user.connect()
      await user.register({
        requestDelegate: {
          onReject: () =>
            this.events.failed(new Error("Gateway rejected SIP registration")),
        },
      })
      await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Gateway registration timed out")),
            10000
          )
        }),
      ])
    } catch (error) {
      await this.close()
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  async microphone() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:
        this.microphoneId === "default"
          ? true
          : { deviceId: { exact: this.microphoneId } },
      video: false,
    })
    stream.getTracks().forEach((track) => track.stop())
  }
  mute(muted: boolean) {
    if (muted) this.user?.mute()
    else this.user?.unmute()
  }
  async dtmf(tone: string) {
    if (!isDtmf(tone)) throw new Error("Invalid DTMF digit")
    await this.user?.sendDTMF(tone)
  }
  async hangup() {
    await this.user?.hangup()
    this.stopTracks()
  }
  private stopTracks() {
    this.user?.localMediaStream?.getTracks().forEach((track) => track.stop())
    this.audio.srcObject = null
  }
  async close() {
    this.disposed = true
    this.stopTracks()
    await this.user?.unregister().catch(() => undefined)
    await this.user?.disconnect().catch(() => undefined)
    this.user = undefined
  }
}
/** Ring audio is armed by the user's Online gesture, satisfying autoplay policy. */
export class RingSound {
  constructor(private readonly changed?: (enabled: boolean) => void) {}
  private context?: AudioContext
  private interval?: ReturnType<typeof setInterval>
  get enabled() {
    return this.context?.state === "running"
  }
  async arm() {
    this.context ??= new AudioContext()
    this.context.onstatechange = () => this.changed?.(this.enabled)
    // Some browsers leave resume pending when this was called without a gesture.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.context.resume(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1000)
        }),
      ])
      return this.enabled
    } finally {
      clearTimeout(timeout)
    }
  }
  start() {
    this.stop()
    const pulse = () => {
      const ctx = this.context
      if (!ctx || ctx.state !== "running") return
      const gain = ctx.createGain(),
        tone = ctx.createOscillator()
      tone.frequency.value = 440
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.03)
      gain.gain.setValueAtTime(0.08, ctx.currentTime + 0.4)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5)
      tone.connect(gain)
      gain.connect(ctx.destination)
      tone.start()
      tone.stop(ctx.currentTime + 0.5)
      tone.onended = () => {
        tone.disconnect()
        gain.disconnect()
      }
    }
    pulse()
    this.interval = setInterval(pulse, 2000)
  }
  stop() {
    clearInterval(this.interval)
    this.interval = undefined
  }
  close() {
    this.stop()
    void this.context?.close()
    this.context = undefined
  }
}
