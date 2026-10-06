import { VoiceRuntime } from "../src/voice-runtime.js"
import { VoiceMediaEndpoint } from "../src/voice-media.js"
import { VoiceBackend } from "../src/voice-backend.js"
import type { CallStateMachine } from "../src/call-state.js"
import type { RouteRequest } from "../src/contracts.js"
import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { CallController } from "../src/controller.js"
import { FreeSwitch } from "../src/esl.js"
import { JanusSession, type JanusEvent } from "../src/janus.js"
import { ConvexCallbacks } from "../src/callbacks.js"
import type { CallbackPayload } from "../src/contracts.js"
import { config } from "../src/config.js"
import { offer, answer } from "./fixtures.js"

function fixture(inviteFailure?: string, voice?: VoiceRuntime) {
  const commands: string[] = [],
    sessions: FakeJanus[] = [],
    events: CallbackPayload[] = []
  const fs = new (class extends FreeSwitch {
    constructor() {
      super("unused", 8021, "unused")
    }
    override get ready() {
      return true
    }
    override async open() {}
    override async api(command: string) {
      commands.push(command)
      return command.includes("current_application") ? "park" : "+OK"
    }
    override async bgapi(command: string) {
      commands.push(command)
      queueMicrotask(() =>
        sessions.at(-1)!.emit("event", {
          janus: "event",
          plugindata: { data: { result: { event: "incomingcall" } } },
          jsep: {
            type: "offer",
            sdp: answer.replace("setup:active", "setup:actpass"),
          },
        })
      )
    }
    override close() {}
  })()
  class FakeJanus extends JanusSession {
    constructor() {
      super("unused", "unused", "unused")
    }
    override async open() {}
    override async info() {
      return { "ice-mode": "full", "ice-role": "controlling" }
    }
    override async message(
      body: Record<string, unknown>,
      jsep?: JanusEvent["jsep"]
    ) {
      commands.push(`janus:${body.request}:${String(body.enabled ?? "")}`)
      queueMicrotask(() => {
        let event = "registered"
        if (body.request === "call") {
          if (inviteFailure) {
            this.emit("event", {
              janus: "event",
              plugindata: {
                data: { result: { event: "hangup", reason: inviteFailure } },
              },
            })
            return
          }
          event = "accepted"
          fs.emit("event", {
            "Event-Name": "CHANNEL_PARK",
            "Unique-ID": randomUUID(),
            variable_opensend_call_id: (body.headers as Record<string, string>)[
              "X-OpenSend-Call-Id"
            ],
          })
        } else if (body.request === "accept") event = "accepted"
        else if (body.request === "opensend_media") event = "media_gate"
        this.emit("event", {
          janus: "event",
          plugindata: { data: { result: { event } } },
          ...(jsep?.type === "offer"
            ? { jsep: { type: "answer", sdp: answer } }
            : {}),
        })
      })
    }
    override async close() {
      commands.push("janus:destroy")
      await super.close()
    }
  }
  const callbacks = new (class extends ConvexCallbacks {
    constructor() {
      super("http://unused", "unused")
    }
    override async emit(_id: string, payload: CallbackPayload) {
      events.push(payload)
    }
  })()
  const options = config(
    Object.fromEntries(
      [
        "CALL_GATEWAY_SECRET",
        "JANUS_API_SECRET",
        "FREESWITCH_ESL_SECRET",
        "FREESWITCH_SIP_SECRET",
        "FREESWITCH_DIRECTORY_SECRET",
        "DRACHTIO_SECRET",
      ]
        .map((key) => [key, "s".repeat(64)])
        .concat([["CALL_GATEWAY_CONVEX_HTTP_URL", "http://unused"]])
    )
  )
  const controller = new CallController(options, {
    voice,
    fs,
    callbacks,
    session: () => {
      const session = new FakeJanus()
      sessions.push(session)
      return session
    },
  })
  return { controller, commands, events, fs, sessions }
}

test("media heartbeats stop when Janus stops receiving audio or the call ends", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setInterval"],
    now: 1_800_000_000_000,
  })
  const f = fixture()
  try {
    await f.controller.start()
    await f.controller.inbound(offer, "heartbeat")
    await f.controller.route({ callId: "heartbeat", target: "ivr" })
    f.sessions[0].emit("event", {
      janus: "media",
      type: "audio",
      receiving: true,
    })
    t.mock.timers.tick(5000)
    assert.equal(
      f.events.filter((event) => event.event === "heartbeat").length,
      1
    )
    t.mock.timers.tick(25000)
    assert.equal(
      f.events.filter((event) => event.event === "heartbeat").length,
      1
    )
    t.mock.timers.tick(5000)
    assert.equal(
      f.events.filter((event) => event.event === "heartbeat").length,
      2
    )
    f.sessions[0].emit("event", {
      janus: "media",
      type: "audio",
      receiving: false,
    })
    t.mock.timers.tick(60000)
    assert.equal(
      f.events.filter((event) => event.event === "heartbeat").length,
      2
    )
    await f.controller.hangup("heartbeat")
    t.mock.timers.tick(60000)
    assert.equal(
      f.events.filter((event) => event.event === "heartbeat").length,
      2
    )
  } finally {
    await f.controller.close()
  }
})

test("a rejected SIP INVITE preserves its cause when controller teardown closes the session", async () => {
  const f = fixture("Not Found")
  try {
    await assert.rejects(f.controller.inbound(offer, "rejected"), {
      code: "SIP_ERROR",
      message: "Not Found",
      status: 502,
    })
    assert.equal(
      f.commands.filter((command) => command === "janus:destroy").length,
      1
    )
    assert.equal(f.events.filter((event) => event.event === "hangup").length, 1)
  } finally {
    await f.controller.close()
  }
})

test("inbound waits for SDP, blocks media until route, reuses answer and handles late finalized recordings", async () => {
  const f = fixture()
  try {
    const first = await f.controller.inbound(offer, "inbound")
    const duplicate = await f.controller.inbound(offer, "inbound")
    assert.deepEqual(first, duplicate)
    assert.equal(f.sessions.length, 1)
    assert.ok(
      !f.commands.some((command) => command === "janus:opensend_media:true")
    )
    await f.controller.route({ callId: "inbound", target: "ivr", record: true })
    await f.controller.route({ callId: "inbound", target: "ivr", record: true })
    assert.equal(
      f.commands.filter((command) => command === "janus:opensend_media:true")
        .length,
      1
    )
    const transfer = f.commands.find((command) =>
      command.startsWith("uuid_transfer")
    )!
    const uuid = transfer.split(" ")[1]
    assert.match(transfer, /ivr-demo XML calling$/)
    await f.controller.hangup("inbound")
    f.fs.emit("event", {
      "Event-Name": "RECORD_STOP",
      "Unique-ID": uuid,
      "Record-File-Path": `/recordings/${uuid}.wav`,
    })
    assert.ok(f.events.some((event) => event.event === "recording_ready"))
    assert.equal(f.events.filter((event) => event.event === "hangup").length, 1)
    await assert.rejects(
      f.controller.inbound(offer, "inbound"),
      /already ended/
    )
  } finally {
    await f.controller.close()
  }
})
test("outbound bridges to its own SIP slot, requires an answer before routing, and forbids renegotiation", async () => {
  const f = fixture()
  try {
    const first = await f.controller.outbound("outbound")
    assert.ok(first.offerSdp)
    assert.equal(f.sessions.length, 1)
    assert.match(
      f.commands.find((command) => command.startsWith("originate "))!,
      /user\/1000@freeswitch &park\(\)/
    )
    await assert.rejects(
      f.controller.route({ callId: "outbound", target: "ivr" }),
      /remoteAnswer/
    )
    const remote = offer.replace("setup:actpass", "setup:passive")
    await f.controller.remoteAnswer("outbound", remote)
    await f.controller.remoteAnswer("outbound", remote)
    assert.equal(
      f.commands.filter((command) => command.startsWith("janus:accept")).length,
      1
    )
    await assert.rejects(
      f.controller.remoteAnswer("outbound", remote.replace("1234 1", "1234 2")),
      /cannot change/
    )
    await f.controller.route({
      callId: "outbound",
      target: "agent",
      extension: "2000",
    })
    assert.ok(
      f.commands.some((command) => command.endsWith("agent-route XML calling"))
    )
    await assert.rejects(
      f.controller.route({ callId: "outbound", target: "ivr" }),
      /already routed/
    )
  } finally {
    await f.controller.close()
  }
})

test("hold/resume gate audio without SIP/Meta renegotiation; transfers use local extensions and configured queues", async () => {
  const f = fixture()
  const previousQueues = process.env.CALL_AGENT_QUEUES
  process.env.CALL_AGENT_QUEUES = JSON.stringify({ "team-a": ["support"] })
  try {
    await f.controller.inbound(offer, "agent-controls")
    await f.controller.route({
      callId: "agent-controls",
      target: "agent",
      extension: "2000",
    })
    const before = f.commands.filter((c) => c.startsWith("janus:")).length
    await f.controller.control({ callId: "agent-controls", operation: "hold" })
    assert.ok(
      f.commands.some((c) => /uuid_audio .* start read mute 1$/.test(c))
    )
    assert.ok(
      f.commands.some((c) => /uuid_audio .* start write mute 1$/.test(c))
    )
    await f.controller.control({
      callId: "agent-controls",
      operation: "resume",
    })
    assert.ok(f.commands.some((c) => /uuid_audio .* stop$/.test(c)))
    assert.equal(
      f.commands.filter((c) => c.startsWith("janus:")).length,
      before
    )
    await assert.rejects(
      f.controller.control({
        callId: "agent-controls",
        operation: "transfer",
        extension: "18005550123",
      }),
      /2000/
    )
    await assert.rejects(
      f.controller.control({
        callId: "agent-controls",
        operation: "transfer",
        queue: "support;api status",
        organizationId: "team-a",
      }),
      /not configured/
    )
    await f.controller.control({
      callId: "agent-controls",
      operation: "transfer",
      extension: "2001",
    })
    assert.ok(f.commands.some((c) => c.endsWith("opensend_agent 2001")))
    await f.controller.control({
      callId: "agent-controls",
      operation: "transfer",
      queue: "support",
      organizationId: "team-a",
    })
    assert.ok(
      f.commands.some((c) => c.endsWith("queue-team-a-support XML calling"))
    )
  } finally {
    if (previousQueues === undefined) delete process.env.CALL_AGENT_QUEUES
    else process.env.CALL_AGENT_QUEUES = previousQueues
    await f.controller.close()
  }
})

test("controlled bot routing installs the cap before opening media, records via UUID, and cleans up on handoff", async () => {
  let machine: CallStateMachine | undefined
  let stopped = 0
  const voice = new (class extends VoiceRuntime {
    constructor() {
      super(
        { port: 0, fakeEnabled: true },
        new VoiceMediaEndpoint({
          host: "unused",
          port: 9022,
          secret: "unused",
          advertiseHost: "unused",
          fsHost: "unused",
        }),
        new VoiceBackend("http://unused", "unused")
      )
    }
    override prepare(
      _id: string,
      _uuid: string,
      _route: RouteRequest,
      state: CallStateMachine
    ) {
      machine = state
    }
    override reportState() {}
    override beginTransfer() {}
    override async releaseForTransfer() {
      f.commands.push("voice:release")
    }
    override async stop() {
      stopped++
    }
    override async close() {}
  })()
  const f = fixture(undefined, voice)
  const route = {
    callId: "bot",
    target: "bot" as const,
    adapter: "fake-echo" as const,
    organizationId: "team",
    maxDurationSeconds: 6,
    record: true,
  }
  try {
    await f.controller.inbound(offer, "bot")
    await f.controller.route(route)
    await f.controller.route(route)
    const cap = f.commands.findIndex((command) =>
      command.startsWith("sched_hangup +6")
    )
    const media = f.commands.indexOf("janus:opensend_media:true")
    assert.ok(cap >= 0 && cap < media)
    assert.equal(
      f.commands.filter((command) => command.startsWith("sched_hangup")).length,
      1
    )
    assert.ok(
      f.commands.some((command) =>
        /uuid_record .* start \/recordings\//.test(command)
      )
    )
    assert.ok(
      f.commands.some((command) =>
        command.endsWith("voice-control XML calling")
      )
    )
    assert.equal(machine?.state, "bot")
    await f.controller.control({
      callId: "bot",
      operation: "transfer",
      extension: "2001",
    })
    assert.ok(
      f.commands.indexOf("voice:release") <
        f.commands.findIndex((command) =>
          command.endsWith("agent-route XML calling")
        )
    )
    assert.equal(machine?.state, "agent")
    assert.equal(stopped, 1)
    await f.controller.hangup("bot")
    assert.equal(machine?.state, "hangup")
  } finally {
    await f.controller.close()
  }
})

test("fake routes require explicit runtime enablement and bounded, trusted inputs", async () => {
  const f = fixture()
  try {
    await f.controller.inbound(offer, "bot-disabled")
    await assert.rejects(
      f.controller.route({
        callId: "bot-disabled",
        target: "bot",
        organizationId: "team",
        adapter: "fake-echo",
      }),
      { code: "BOT_UNAVAILABLE" }
    )
    await assert.rejects(
      f.controller.route({
        callId: "bot-disabled",
        target: "ivr",
        maxDurationSeconds: 0,
      }),
      { code: "INVALID_DURATION" }
    )
    await assert.rejects(
      f.controller.route({
        callId: "bot-disabled",
        target: "ivr",
        maxDurationSeconds: 3601,
      }),
      { code: "INVALID_DURATION" }
    )
    await f.controller.route({ callId: "bot-disabled", target: "hangup" })
    assert.equal(f.commands.includes("janus:opensend_media:true"), false)
  } finally {
    await f.controller.close()
  }
})

test("anchored FreeSWITCH hangup cause wins a racing Janus SIP termination", async () => {
  const f = fixture()
  try {
    await f.controller.inbound(offer, "cap-cause")
    await f.controller.route({ callId: "cap-cause", target: "ivr" })
    const uuid = f.commands
      .find((command) => command.startsWith("uuid_transfer"))!
      .split(" ")[1]
    f.sessions[0].emit("event", {
      janus: "hangup",
      plugindata: {
        data: { result: { event: "hangup", reason: "Session Terminated" } },
      },
    })
    f.fs.emit("event", {
      "Event-Name": "CHANNEL_HANGUP",
      "Unique-ID": uuid,
      "Hangup-Cause": "ALLOTTED_TIMEOUT",
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    const ended = f.events.filter((event) => event.event === "hangup")
    assert.deepEqual(ended, [{ event: "hangup", reason: "ALLOTTED_TIMEOUT" }])
  } finally {
    await f.controller.close()
  }
})

test("playground anchors an authorized browser caller and runs the same controlled IVR route without Janus signaling", async () => {
  const voice = {
    fakeEnabled: false,
    prepare() {},
    reportState() {},
    async stop() {},
    async close() {},
  } as unknown as VoiceRuntime
  const { controller, commands } = fixture(undefined, voice)
  await assert.rejects(
    controller.playground({ callId: "test-call", extension: "1000" }),
    /Invalid browser/
  )
  await controller.playground({ callId: "test-call", extension: "2001" })
  await controller.route({
    callId: "test-call",
    target: "ivr",
    ivrId: "ivr-reception",
    organizationId: "team",
  })
  assert.ok(
    commands.some((c) => c.startsWith("originate ") && c.includes("user/2001@"))
  )
  assert.ok(commands.some((c) => c.includes("voice-control XML calling")))
  assert.ok(commands.some((c) => c.startsWith("sched_hangup +300")))
  assert.ok(!commands.some((c) => c.startsWith("janus:opensend_media")))
  await assert.rejects(
    controller.playground({ callId: "test-call", extension: "2002" }),
    /Browser call differs/
  )
  await controller.hangup("test-call")
  await assert.rejects(
    controller.playground({ callId: "test-call", extension: "2001" }),
    /Call already ended/
  )
})

test("Meta hangup callback and Janus teardown do not wait for bot summarization", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const voice = new (class extends VoiceRuntime {
    constructor() {
      super(
        { port: 0, fakeEnabled: true },
        {} as VoiceMediaEndpoint,
        {} as VoiceBackend
      )
    }
    override async stop() {
      await blocked
    }
    override async close() {}
  })()
  const f = fixture(undefined, voice)
  try {
    await f.controller.inbound(offer, "slow-summary")
    const ending = f.controller.hangup("slow-summary")
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(f.commands.some((c) => c.startsWith("uuid_kill ")))
    assert.ok(f.commands.includes("janus:destroy"))
    assert.equal(f.events.filter((e) => e.event === "hangup").length, 1)
    release()
    await ending
  } finally {
    release()
    await f.controller.close()
  }
})
