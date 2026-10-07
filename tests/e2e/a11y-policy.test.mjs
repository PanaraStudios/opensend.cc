import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Window } from "happy-dom"
import {
  A11Y_FULL_TAGS,
  A11Y_THEME_RULES,
  A11Y_MOBILE_STATES,
  A11Y_PREVIEW_FRAME_SELECTOR,
  A11yScanTimeoutError,
  a11yScanMode,
  blocksA11yTour,
  withinA11yScanBudget,
} from "./a11y-policy.ts"

test("preview exclusion prevents axe frame traversal without excluding other UI frames", async () => {
  const require = createRequire(import.meta.url)
  const axe = createRequire(require.resolve("@axe-core/playwright"))("axe-core")
  const window = new Window({ settings: { disableIframePageLoading: true } })
  try {
    window.document.body.innerHTML = `
      <iframe data-slot="email-preview-frame" sandbox="" title="Email preview"></iframe>
      <iframe data-slot="email-preview-frame" sandbox="" title="HTML block"></iframe>
      <iframe id="ui-frame" title="Application UI"></iframe>
    `
    window.eval(axe.source)
    assert.equal(
      window.axe.utils.getFrameContexts({ include: ["body"] }).length,
      3
    )
    const frames = window.axe.utils.getFrameContexts({
      include: ["body"],
      exclude: [A11Y_PREVIEW_FRAME_SELECTOR],
    })
    assert.equal(frames.length, 1)
    assert.ok(
      window.document.querySelector(frames[0].frameSelector) ===
        window.document.getElementById("ui-frame")
    )
  } finally {
    await window.happyDOM.close()
  }
})

test("scan budget retains successful results and surfaces engine failures", async () => {
  const result = { violations: [] }
  assert.equal(await withinA11yScanBudget(async () => result), result)
  const error = new TypeError("Scan engine failed")
  await assert.rejects(
    withinA11yScanBudget(async () => {
      throw error
    }),
    (caught) => caught === error
  )
})

test("an unresponsive scan fails its hard budget rather than blocking the tour", async () => {
  await assert.rejects(
    withinA11yScanBudget(() => new Promise(() => {}), 10),
    (error) => {
      assert.ok(error instanceof A11yScanTimeoutError)
      assert.match(error.message, /exceeded/)
      return true
    }
  )
})

test("tour scans each desktop state fully in light and only theme rules in dark", () => {
  for (const screen of [
    "audience-contacts",
    "channels-add-menu",
    ...A11Y_MOBILE_STATES.keys(),
  ]) {
    assert.equal(a11yScanMode({ screen, theme: "light", width: 1280 }), "full")
    assert.equal(a11yScanMode({ screen, theme: "dark", width: 1280 }), "theme")
  }
})

test("mobile scans are limited to the four documented structural variants in both themes", () => {
  assert.deepEqual([...A11Y_MOBILE_STATES.keys()].sort(), [
    "playground-inbox",
    "playground-ivr-editor",
    "playground-voice-bot-detail",
    "profile",
  ])
  for (const theme of ["light", "dark"]) {
    for (const screen of A11Y_MOBILE_STATES.keys())
      assert.equal(a11yScanMode({ screen, theme, width: 390 }), "full")
    for (const screen of [
      "audience-contacts",
      "channels-add-menu",
      "call-with-bot-dialog",
      "automation-trigger-picker",
    ])
      assert.equal(a11yScanMode({ screen, theme, width: 390 }), "skip")
  }
})

test("dark desktop rules retain all colour rules from the installed axe full tags", () => {
  const require = createRequire(import.meta.url)
  const axe = createRequire(require.resolve("@axe-core/playwright"))("axe-core")
  const colourRules = axe
    .getRules(A11Y_FULL_TAGS)
    .filter((rule) => rule.tags.includes("cat.color"))
    .map((rule) => rule.ruleId)
  assert.deepEqual([...A11Y_THEME_RULES].sort(), colourRules.sort())
})

test("accessibility gate blocks serious/critical issues, retaining lower impacts for review", () => {
  for (const impact of ["critical", "serious"])
    assert.equal(blocksA11yTour({ ruleId: "button-name", impact }), true)
  for (const impact of ["moderate", "minor", null])
    assert.equal(blocksA11yTour({ ruleId: "heading-order", impact }), false)
})

test("an explicit exception only exempts that rule, including at critical impact", () => {
  const allowlist = new Set(["third-party-rule"])
  assert.equal(
    blocksA11yTour(
      { ruleId: "third-party-rule", impact: "critical" },
      allowlist
    ),
    false
  )
  assert.equal(
    blocksA11yTour({ ruleId: "button-name", impact: "serious" }, allowlist),
    true
  )
  assert.equal(
    blocksA11yTour({ ruleId: "button-name", impact: "critical" }, allowlist),
    true
  )
})
