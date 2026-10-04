import { test } from "node:test"
import assert from "node:assert/strict"
import { fitZoom, ZOOM_STEPS } from "./flow-zoom"

test("a canvas opens at 100% when its graph fits", () => {
  assert.equal(ZOOM_STEPS[fitZoom(600, 900)], 1)
})
test("a wide graph opens at the largest step that fits, never above 100%", () => {
  assert.equal(ZOOM_STEPS[fitZoom(1000, 900)], 0.75)
  assert.equal(ZOOM_STEPS[fitZoom(1500, 900)], 0.5)
  assert.equal(ZOOM_STEPS[fitZoom(100, 4000)], 1)
})
test("a graph too wide for every step opens at the smallest", () => {
  assert.equal(ZOOM_STEPS[fitZoom(5000, 900)], 0.5)
})
