import assert from "node:assert/strict"
import { test } from "node:test"
import { randomBytes } from "node:crypto"
import {
  browserIceServers,
  DEFAULT_STUN_URLS,
  iceNeedsRefresh,
  usesTurn,
  type IceConfiguration,
} from "./calling/ice"

test("browser selects STUN only when no TURN configuration is supplied", () => {
  const fallback = browserIceServers()
  assert.deepEqual(fallback, [{ urls: DEFAULT_STUN_URLS }])
  assert.equal(usesTurn(fallback), false)
  assert.deepEqual(
    browserIceServers({
      iceServers: [{ urls: ["stun:stun.example.test:3478"] }],
      expiresAt: null,
    }),
    [{ urls: ["stun:stun.example.test:3478"] }]
  )
})

test("browser uses fresh TURN credentials, refreshes five minutes early and drops expired credentials", () => {
  const configuration: IceConfiguration = {
    iceServers: [
      { urls: ["stun:stun.example.test:3478"] },
      {
        urls: ["turn:relay.example.test:3478", "turns:relay.example.test:5349"],
        username: "3601:opaque-session",
        credential: randomBytes(20).toString("base64"),
      },
    ],
    expiresAt: 3601000,
  }
  assert.equal(usesTurn(browserIceServers(configuration, 1000)), true)
  assert.equal(iceNeedsRefresh(configuration, 1000), false)
  assert.equal(iceNeedsRefresh(configuration, 3301000), true)
  assert.deepEqual(browserIceServers(configuration, 3601000), [
    configuration.iceServers[0],
  ])
  assert.equal(usesTurn(browserIceServers(configuration, 3601000)), false)
  assert.equal(iceNeedsRefresh({ iceServers: [], expiresAt: null }), false)
})
