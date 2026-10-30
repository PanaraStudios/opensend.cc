import assert from "node:assert/strict"
import { test } from "node:test"
import { ivrRoutesToBot, type IvrBotRoutes } from "./ivr-bot-references"

const menu = (overrides: Partial<IvrBotRoutes["menus"][number]> = {}) => ({
  options: { "1": { kind: "agents" } },
  noInputAction: { kind: "hangup" },
  failureAction: { kind: "voicemail" },
  ...overrides,
})

test("IVR without bot actions does not reference the bot", () => {
  assert.equal(ivrRoutesToBot({ menus: [menu()] }, "bot1"), false)
})

test("IVR referencing a different bot does not block deletion", () => {
  const ivr = {
    menus: [menu({ options: { "1": { kind: "bot", botId: "bot2" } } })],
  }
  assert.equal(ivrRoutesToBot(ivr, "bot1"), false)
})

test("menu option, noInput, failure and closed actions all count as routes", () => {
  const bot = { kind: "bot", botId: "bot1" }
  assert.equal(
    ivrRoutesToBot(
      { menus: [menu(), menu({ options: { "2": bot } })] },
      "bot1"
    ),
    true
  )
  assert.equal(
    ivrRoutesToBot({ menus: [menu({ noInputAction: bot })] }, "bot1"),
    true
  )
  assert.equal(
    ivrRoutesToBot({ menus: [menu({ failureAction: bot })] }, "bot1"),
    true
  )
  assert.equal(
    ivrRoutesToBot(
      { menus: [menu()], businessHours: { closedAction: bot } },
      "bot1"
    ),
    true
  )
})
