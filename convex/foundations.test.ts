/// <reference types="vite/client" />
import { describe, expect, test } from "vitest"
import { convexTest } from "convex-test"
import schema from "./schema"
import authSchema from "./betterAuth/schema"
import { components, internal } from "./_generated/api"
import { emitEvent } from "./events"
import { renderEmail } from "./email/render"
import { formatVariable } from "../lib/dashboard/email-variables"

const modules = import.meta.glob("./**/*.ts")
const authModules = import.meta.glob("./betterAuth/**/*.ts")

describe("event outbox", () => {
  test("an event is stored with its team, type and data", async () => {
    const t = convexTest(schema, modules)
    const id = await t.run((ctx) =>
      emitEvent(ctx, "team", "domain.created", { domain_id: "dom" })
    )
    const row = await t.run((ctx) => ctx.db.get("events", id))
    expect(row).toMatchObject({
      organizationId: "team",
      type: "domain.created",
      data: { domain_id: "dom" },
    })
    // Drain both outbox consumers before another test creates its Convex context.
    await t.finishAllScheduledFunctions(() => {})
  })
})

describe("renderEmail", () => {
  const name = formatVariable("contact.first_name", "there")
  test("fills merge tags, escapes HTML values and derives plain text", () => {
    const out = renderEmail(
      { subject: `Hi ${name}`, html: `<p>Hi ${name}</p>` },
      { "contact.first_name": "<Ada>" }
    )
    expect(out.subject).toBe("Hi <Ada>")
    expect(out.html).toBe("<p>Hi &lt;Ada&gt;</p>")
    expect(out.text).toBe("Hi <Ada>")
  })
  test("an explicit plain-text part is filled, not derived", () => {
    const out = renderEmail(
      { subject: "s", html: "<p>x</p>", text: `Hey ${name}` },
      {}
    )
    expect(out.text).toBe("Hey there")
  })
})

describe("super admin transfer", () => {
  test("moves the role to a verified account and refuses anyone else", async () => {
    const t = convexTest(schema, modules)
    t.registerComponent("betterAuth", authSchema, authModules)
    const account = async (name: string, emailVerified = true) => {
      const user = await t.mutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name,
            email: `${name}@example.test`,
            emailVerified,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      })
      const session = await t.mutation(components.betterAuth.adapter.create, {
        input: {
          model: "session",
          data: {
            userId: user._id,
            token: name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          },
        },
      })
      return { user, sessionId: session._id as string }
    }
    const admin = (sessionId: string) =>
      t.query(components.betterAuth.policy.authorizeInstallation, {
        sessionId,
      })
    const first = await account("first")
    await t.mutation(components.betterAuth.policy.admitUser, {
      userId: first.user._id,
      email: first.user.email,
    })
    const second = await account("second")
    await account("unverified", false)
    await expect(
      t.mutation(internal.installationAdmin.transfer, {
        email: "unverified@example.test",
      })
    ).rejects.toThrow("No verified account")
    await expect(
      t.mutation(internal.installationAdmin.transfer, {
        email: "nobody@example.test",
      })
    ).rejects.toThrow("No verified account")
    await t.mutation(internal.installationAdmin.transfer, {
      email: "Second@Example.test",
    })
    expect(await admin(second.sessionId)).toEqual({ admin: true })
    expect(await admin(first.sessionId)).toEqual({ admin: false })
  })
})
