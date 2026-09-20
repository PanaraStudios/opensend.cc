import { describe, expect, it } from "vitest"
import {
  chunk,
  extractAddress,
  isDeepEqual,
  isSesSimulatorAddress,
  stableStringify,
} from "./utils.js"

describe("isSesSimulatorAddress", () => {
  it("allows every mailbox simulator scenario", () => {
    for (const scenario of [
      "success",
      "bounce",
      "ooto",
      "complaint",
      "suppressionlist",
    ]) {
      expect(isSesSimulatorAddress(`${scenario}@simulator.amazonses.com`)).toBe(
        true
      )
    }
  })

  it("allows labels and display names", () => {
    expect(isSesSimulatorAddress("bounce+label1@simulator.amazonses.com")).toBe(
      true
    )
    expect(
      isSesSimulatorAddress("success+user_1-a@simulator.amazonses.com")
    ).toBe(true)
    expect(isSesSimulatorAddress("complaint+@simulator.amazonses.com")).toBe(
      true
    )
    expect(
      isSesSimulatorAddress('"Test User" <success@simulator.amazonses.com>')
    ).toBe(true)
  })

  it("rejects real addresses and lookalikes", () => {
    expect(isSesSimulatorAddress("user@example.com")).toBe(false)
    expect(isSesSimulatorAddress("delivered@simulator.amazonses.com")).toBe(
      false
    )
    expect(
      isSesSimulatorAddress("success@simulator.amazonses.com.evil.io")
    ).toBe(false)
    expect(isSesSimulatorAddress("success@amazonses.com")).toBe(false)
    expect(isSesSimulatorAddress("success+a.b@simulator.amazonses.com")).toBe(
      false
    )
  })
})

describe("extractAddress", () => {
  it("unwraps display names", () => {
    expect(extractAddress("Sender Name <sender@example.com>")).toBe(
      "sender@example.com"
    )
    expect(extractAddress("sender@example.com")).toBe("sender@example.com")
  })
})

describe("stableStringify / isDeepEqual", () => {
  it("ignores key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    )
    expect(isDeepEqual({ b: 1, a: [1, 2] }, { a: [1, 2], b: 1 })).toBe(true)
    expect(isDeepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  })
})

describe("chunk", () => {
  it("splits into bounded groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
    expect(() => chunk([1], 0)).toThrow()
  })
})
