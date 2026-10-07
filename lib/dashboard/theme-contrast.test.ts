import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const css = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "")

function declarations(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`))?.[1]
  assert.ok(block, `Missing theme ${selector}`)
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ])
  )
}

const light = declarations(":root")
const dark = { ...light, ...declarations("\\.dark") }
type RGB = readonly number[]

function color(
  theme: Record<string, string>,
  token: string,
  seen: string[] = []
): RGB {
  assert.ok(
    !seen.includes(token),
    `Circular token alias: ${[...seen, token].join(" -> ")}`
  )
  const value = theme[token]
  assert.ok(value, `Missing token ${token}`)
  const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  if (alias) return color(theme, alias, [...seen, token])
  assert.match(
    value,
    /^#[0-9a-f]{6}$/i,
    `${token} needs a supported colour value`
  )
  return hex(value)
}

function hex(value: string): RGB {
  return [1, 3, 5].map(
    (offset) => parseInt(value.slice(offset, offset + 2), 16) / 255
  )
}

// WCAG relative luminance uses linear sRGB, not averages of hex channels.
function luminance(rgb: RGB): number {
  const channels = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: RGB, background: RGB): number {
  const [low, high] = [luminance(foreground), luminance(background)].sort(
    (a, b) => a - b
  )
  return (high + 0.05) / (low + 0.05)
}

function assertAA(
  foreground: RGB,
  background: RGB,
  label: string,
  opacity = 1
) {
  const effective = foreground.map(
    (channel, index) => channel * opacity + background[index] * (1 - opacity)
  )
  const rounded = effective.map((channel) => Math.round(channel * 255) / 255)
  // Check both exact compositing and displayed 8-bit colours near the threshold.
  for (const rgb of [effective, rounded]) {
    const ratio = contrast(rgb, background)
    assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(4)}:1; expected >=4.5:1`)
  }
}

test("WCAG contrast calculation has the black/white and equal-colour reference ratios", () => {
  assert.equal(contrast(hex("#000000"), hex("#ffffff")), 21)
  assert.equal(contrast(hex("#707070"), hex("#707070")), 1)
})

test("light theme text tokens meet AA on their page, muted, badge and avatar backgrounds", () => {
  for (const [foreground, soft] of [
    ["--success", "--success-soft"],
    ["--muted-foreground", "--muted"],
    ["--warning", "--warning-soft"],
    ["--destructive", "--destructive-soft"],
  ]) {
    const ink = color(light, foreground)
    for (const background of ["--background", "--surface", "--muted", soft])
      assertAA(ink, color(light, background), `${foreground} on ${background}`)
    // Linux measured #f8f8f8 on the composited page, versus the #fafafa base token.
    assertAA(ink, hex("#f8f8f8"), `${foreground} on observed page`)
  }
})

test("status descriptions remain AA at the shared Alert's 90% text opacity", () => {
  const alert = readFileSync(
    new URL("../../components/ui/alert.tsx", import.meta.url),
    "utf8"
  )
  for (const tone of ["success", "warning", "destructive"]) {
    assert.ok(
      alert.includes(`text-${tone}/90`),
      `Revisit contrast coverage if ${tone} opacity changes`
    )
    assertAA(
      color(light, `--${tone}`),
      color(light, `--${tone}-soft`),
      `${tone} description at 90%`,
      0.9
    )
  }
})

test("dark placeholders meet AA on the actual dark field background", () => {
  assertAA(
    color(dark, "--faint-foreground"),
    color(dark, "--field"),
    "dark placeholder on field"
  )
  assertAA(
    color(dark, "--faint-foreground"),
    color(dark, "--background"),
    "dark placeholder on page"
  )
})
