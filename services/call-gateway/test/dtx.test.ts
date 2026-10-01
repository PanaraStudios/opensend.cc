import { test } from "node:test"
import assert from "node:assert/strict"
import { metaSdp } from "../src/sdp.js"
import { offer } from "./fixtures.js"

test("Opus DTX is disabled both as the first and a later fmtp parameter", () => {
  for (const parameters of ["usedtx=1;minptime=10", "minptime=10; usedtx=1"]) {
    const sdp = metaSdp(
      offer.replace("minptime=10;useinbandfec=1", parameters),
      "offer"
    )
    assert.match(sdp, /usedtx=0/)
    assert.doesNotMatch(sdp, /usedtx=1/)
  }
})
