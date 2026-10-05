/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "./schema"
import { emailMessageShape, messageBase } from "./messageShape"

const modules = import.meta.glob("./**/*.ts")

test("a unified message carries an ISO time and does not invent a contact", () => {
  expect(
    messageBase(
      {
        _id: "message",
        _creationTime: Date.UTC(2026, 9, 2, 12, 0, 0),
        from: "Ada <ada@example.test>",
        to: ["grace@example.test"],
      },
      "email",
      "outbound",
      "sent",
      "Hello",
      null
    )
  ).toEqual({
    id: "message",
    object: "message",
    channel: "email",
    direction: "outbound",
    from: "Ada <ada@example.test>",
    to: ["grace@example.test"],
    status: "sent",
    preview: "Hello",
    created_at: "2026-10-02T12:00:00.000Z",
    contact_id: null,
  })
})

test("email messages link the primary mailbox in the same team", async () => {
  const t = convexTest(schema, modules)
  const team = "team"
  const other = "other"
  const rows = await t.run(async (ctx) => {
    const domainId = await ctx.db.insert("domains", {
      organizationId: team,
      name: "mail.example.test",
      region: "us-east-1",
      customReturnPath: "send",
      status: "verified",
      phase: "ready",
      deleted: false,
      sending: true,
      tls: "opportunistic",
      records: [],
      sesVerified: true,
      dkimVerified: true,
      mailFromVerified: true,
      operation: "provision",
    })
    const ada = await ctx.db.insert("contacts", {
      organizationId: team,
      email: "ada@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      unsubscribed: false,
      properties: {},
      search: "ada",
      updatedAt: 1,
    })
    await ctx.db.insert("contacts", {
      organizationId: other,
      email: "ada@example.test",
      firstName: "Other",
      lastName: "Ada",
      unsubscribed: false,
      properties: {},
      search: "ada",
      updatedAt: 1,
    })
    const grace = await ctx.db.insert("contacts", {
      organizationId: team,
      email: "grace@example.test",
      firstName: "Grace",
      lastName: "Hopper",
      unsubscribed: false,
      properties: {},
      search: "grace",
      updatedAt: 1,
    })
    const outbound = await ctx.db.insert("emails", {
      organizationId: team,
      domainId,
      from: "Opensend <hello@mail.example.test>",
      to: ["Ada <Ada@Example.Test>"],
      replyTo: ["reply@example.test"],
      subject: "Hello",
      status: "sent",
      tags: [{ name: "flow", value: "welcome" }],
      source: "api",
      generation: 1,
      attempts: 0,
      search: "ada",
    })
    await ctx.db.insert("emailContents", {
      emailId: outbound,
      html: "<p>Hi</p>",
    })
    const blank = await ctx.db.insert("emails", {
      organizationId: team,
      domainId,
      from: "Opensend <hello@mail.example.test>",
      to: ["ada@example.test"],
      subject: "Subject fallback",
      status: "queued",
      source: "dashboard",
      generation: 1,
      attempts: 0,
      search: "ada",
    })
    await ctx.db.insert("emailContents", {
      emailId: blank,
      text: "",
      html: "<p>Hidden</p>",
    })
    const unreadable = await ctx.db.insert("emails", {
      organizationId: team,
      domainId,
      from: "Opensend <hello@mail.example.test>",
      to: ["not an address"],
      subject: "Nope",
      status: "failed",
      source: "api",
      generation: 1,
      attempts: 1,
      search: "",
    })
    const inboundMessage = await ctx.db.insert("inboundMessages", {
      organizationId: team,
      domainId,
      region: "us-east-1",
      topicArn: "arn:example",
      messageId: "sns",
      sesMessageId: "ses",
      bucket: "mail",
      objectKey: "ses",
      notification: "{}",
    })
    const inbound = await ctx.db.insert("receivedEmails", {
      organizationId: team,
      inboundId: inboundMessage,
      domainId,
      from: "Grace <grace@example.test>",
      sender: "grace@example.test",
      to: ["Ada <ada@example.test>"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Re: Hello",
      messageId: "<re@example.test>",
      receivedFor: ["ada@example.test"],
      authentication: {},
      receivedAt: 1,
      expiresAt: 2,
    })
    await ctx.db.insert("receivedContents", {
      emailId: inbound,
      html: "<p>Reply</p>",
      text: "Reply",
      headers: {},
    })
    return { ada, grace, outbound, blank, unreadable, inbound }
  })

  const outbound = await t.run(async (ctx) =>
    emailMessageShape(ctx, (await ctx.db.get("emails", rows.outbound))!)
  )
  expect(outbound).toMatchObject({
    channel: "email",
    direction: "outbound",
    status: "sent",
    preview: "<p>Hi</p>",
    html: "<p>Hi</p>",
    text: null,
    subject: "Hello",
    reply_to: ["reply@example.test"],
    tags: [{ name: "flow", value: "welcome" }],
    contact_id: rows.ada,
  })

  const blank = await t.run(async (ctx) =>
    emailMessageShape(ctx, (await ctx.db.get("emails", rows.blank))!)
  )
  expect(blank.preview).toBe("")
  expect(blank.text).toBe("")

  const unreadable = await t.run(async (ctx) =>
    emailMessageShape(ctx, (await ctx.db.get("emails", rows.unreadable))!)
  )
  expect(unreadable.contact_id).toBeNull()
  expect(unreadable.preview).toBe("Nope")

  const inbound = await t.run(async (ctx) =>
    emailMessageShape(
      ctx,
      (await ctx.db.get("receivedEmails", rows.inbound))!
    )
  )
  expect(inbound).toMatchObject({
    direction: "inbound",
    status: "received",
    preview: "Reply",
    text: "Reply",
    html: "<p>Reply</p>",
    tags: [],
    contact_id: rows.grace,
  })
  expect(inbound.contact_id).not.toBe(rows.ada)

  const contacts = await t.run((ctx) => ctx.db.query("contacts").collect())
  expect(contacts).toHaveLength(3)
})

test("message ids stay the stored document ids", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) => {
    const domainId = await ctx.db.insert("domains", {
      organizationId: "team",
      name: "mail.example.test",
      region: "us-east-1",
      customReturnPath: "send",
      status: "pending",
      phase: "pending",
      deleted: false,
      sending: false,
      tls: "opportunistic",
      records: [],
      sesVerified: false,
      dkimVerified: false,
      mailFromVerified: false,
      operation: "provision",
    })
    return ctx.db.insert("emails", {
      organizationId: "team",
      domainId,
      from: "hello@mail.example.test",
      to: [],
      subject: "Empty",
      status: "queued",
      source: "system",
      generation: 0,
      attempts: 0,
      search: "",
    })
  })
  const shaped = await t.run(async (ctx) =>
    emailMessageShape(ctx, (await ctx.db.get("emails", id))!)
  )
  expect(shaped.id).toBe(id)
  expect(shaped.contact_id).toBeNull()
  expect(shaped.to).toEqual([])
})
