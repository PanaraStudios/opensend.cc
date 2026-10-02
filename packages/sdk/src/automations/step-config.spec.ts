import { describe, expect, it } from "vitest"
import { parseStepConfig } from "../common/utils/parse-automation-to-api-options"
import { parseApiStepConfig } from "./step-config"
import { rowChannel } from "./channels"
import type { AutomationStep } from "./interfaces/automation-step.interface"

describe("automation config round trips", () => {
  const steps: AutomationStep[] = [
    {
      key: "trigger",
      type: "trigger",
      config: { eventName: "customer.created" },
    },
    {
      key: "wa",
      type: "send_whatsapp",
      config: {
        accountId: "number",
        mode: "template",
        templateId: "template",
        variables: { name: { contact: "firstName" } },
      },
    },
    {
      key: "text",
      type: "send_whatsapp",
      config: {
        accountId: "number",
        mode: "text",
        text: "Hello",
        variables: {},
      },
    },
    {
      key: "wait",
      type: "wait_for_event",
      config: { eventName: "replied", timeout: "1 day" },
    },
    {
      key: "segment",
      type: "add_to_segment",
      config: { segmentId: "segment" },
    },
  ]
  for (const step of steps)
    it(`restores ${step.key} SDK fields`, () => {
      const api = parseStepConfig(step)
      expect(
        parseApiStepConfig({
          type: step.type,
          config: api.config as Record<string, unknown>,
        })
      ).toMatchObject(step.config)
    })
  it("preserves unknown fields without changing the response", () => {
    const config = { account_id: "n", extra: { future: true } }
    expect(parseApiStepConfig({ type: "send_whatsapp", config })).toEqual({
      accountId: "n",
      extra: { future: true },
    })
    expect(config).toHaveProperty("account_id")
  })
  it("defaults legacy resources to email", () => {
    expect(rowChannel({})).toBe("email")
    expect(rowChannel({ channel: "whatsapp" })).toBe("whatsapp")
  })
})

for (const type of ["send_messenger", "send_instagram"] as const) {
  describe(`${type} wire config`, () => {
    for (const config of [
      { accountId: "page", mode: "text" as const, text: "Reply" },
      {
        accountId: "page",
        mode: "template" as const,
        templateId: "published",
        variables: {
          name: { contact: "firstName" as const, fallback: "friend" },
          company: { property: "company", fallback: "Acme" },
          reply: { value: "YES" },
        },
      },
    ]) {
      it(`round trips ${config.mode} and its variable mappings`, () => {
        const step: AutomationStep = { key: "reply", type, config }
        const wire = parseStepConfig(step)
        expect(wire.type).toBe(type)
        expect(wire.config).toMatchObject({
          account_id: "page",
          mode: config.mode,
        })
        expect(wire.config).not.toHaveProperty("accountId")
        expect(wire.config).not.toHaveProperty("templateId")
        if (config.mode === "template")
          expect(wire.config).toHaveProperty("template_id", "published")
        else expect(wire.config).toHaveProperty("variables", {})
        expect(
          parseApiStepConfig({
            type,
            config: wire.config as Record<string, unknown>,
          })
        ).toMatchObject(config)
      })
    }
  })
}
