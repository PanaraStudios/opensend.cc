import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { youtubeVideoId } from "./youtube"

describe("youtubeVideoId", () => {
  it("reads the id from the common URL shapes", () => {
    for (const input of [
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      assert.equal(youtubeVideoId(input), "dQw4w9WgXcQ", input)
    }
  })

  it("rejects anything that is not a YouTube video", () => {
    assert.equal(youtubeVideoId(""), null)
    assert.equal(youtubeVideoId("https://vimeo.com/123456"), null)
    assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=short"), null)
  })
})
