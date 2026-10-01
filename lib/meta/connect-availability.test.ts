import assert from "node:assert/strict"
import { test } from "node:test"
import {
  metaConfigurationNotice,
  metaConnectUnavailable,
  type MetaConnectConfig,
} from "./connect-availability"

const ready = { canWrite: true, sdkReady: true, pending: false }
const config: MetaConnectConfig = {
  configured: true,
  appId: "123",
  graphVersion: "v25.0",
  configIds: { whatsapp: "wa", facebookLogin: "fb" },
}

test("one notice covers every combination of missing configuration IDs", () => {
  assert.equal(metaConfigurationNotice(config.configIds), null)
  assert.equal(
    metaConfigurationNotice({}),
    "Connect with Meta needs configuration IDs. You can still connect manually with an access token."
  )
  assert.match(
    metaConfigurationNotice({ whatsapp: "wa" })!,
    /Facebook Login for Business is unavailable/
  )
  assert.match(
    metaConfigurationNotice({ facebookLogin: "fb" })!,
    /WhatsApp Embedded Signup is unavailable/
  )
})

test("each login flow uses its own config ID for the disabled state and tooltip", () => {
  for (const flow of ["whatsapp", "facebookLogin"] as const) {
    assert.equal(metaConnectUnavailable(config, flow, ready), null)
    const missing = {
      ...config,
      configIds: { ...config.configIds, [flow]: undefined },
    }
    assert.match(
      metaConnectUnavailable(missing, flow, ready)!,
      flow === "whatsapp"
        ? /WhatsApp Embedded Signup config ID/
        : /Facebook Login for Business config ID/
    )
    assert.equal(
      metaConnectUnavailable(
        missing,
        flow === "whatsapp" ? "facebookLogin" : "whatsapp",
        ready
      ),
      null
    )
    assert.match(
      metaConnectUnavailable(undefined, flow, ready)!,
      /add the Meta app/
    )
    assert.match(
      metaConnectUnavailable({ ...config, configured: false }, flow, ready)!,
      /add the Meta app/
    )
    assert.match(
      metaConnectUnavailable(config, flow, { ...ready, canWrite: false })!,
      /Create or join a team/
    )
    assert.match(
      metaConnectUnavailable(config, flow, { ...ready, sdkReady: false })!,
      /SDK/
    )
    assert.match(
      metaConnectUnavailable(config, flow, { ...ready, pending: true })!,
      /connection to finish/
    )
  }
})
