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

function fixture(inviteFailure?: string) {
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
      ]
        .map((key) => [key, "s".repeat(64)])
        .concat([["CALL_GATEWAY_CONVEX_HTTP_URL", "http://unused"]])
    )
  )
  const controller = new CallController(options, {
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
