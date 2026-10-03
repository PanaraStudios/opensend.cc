import assert from "node:assert/strict"
import { test } from "node:test"
import {
  manualConnectUnavailable,
  metaConnectRoute,
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

test("a channel without its config ID connects with an access token instead", () => {
  for (const flow of ["whatsapp", "facebookLogin"] as const) {
    assert.deepEqual(metaConnectRoute(config, flow, ready), {
      manual: false,
      reason: null,
    })
    const missing = {
      ...config,
      configIds: { ...config.configIds, [flow]: undefined },
    }
    assert.deepEqual(metaConnectRoute(missing, flow, ready), {
      manual: true,
      reason: null,
    })
    assert.deepEqual(
      metaConnectRoute(missing, flow, { ...ready, sdkReady: false }),
      { manual: true, reason: null }
    )
    assert.match(
      metaConnectRoute(config, flow, { ...ready, pending: true }).reason!,
      /connection to finish/
    )
    for (const blocked of [
      metaConnectRoute(undefined, flow, ready),
      metaConnectRoute(missing, flow, { ...ready, canWrite: false }),
    ]) {
      assert.equal(blocked.manual, false)
      assert.ok(blocked.reason)
    }
  }
  assert.equal(manualConnectUnavailable(config, true), null)
  assert.match(manualConnectUnavailable(config, false)!, /Create or join/)
  assert.match(manualConnectUnavailable(undefined, true)!, /add the Meta app/)
})
