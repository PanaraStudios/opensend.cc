import { test } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  clampMediaTime,
  createAudioCoordinator,
  formatMediaTime,
  mediaKeyAction,
  nextPlaybackSpeed,
  isVideoNoteFrame,
  showVideoDurationBadge,
  videoPreviewSource,
} from "./media-player"
import { AudioPlayer } from "../components/ui/audio-player"
import { VideoPlayer } from "../components/ui/video-player"

test("media time handles fractional, unknown, negative and hour-long durations", () => {
  for (const [seconds, expected] of [
    [0, "0:00"],
    [9.9, "0:09"],
    [95, "1:35"],
    [3605, "1:00:05"],
    [Infinity, "0:00"],
    [NaN, "0:00"],
    [-9, "0:00"],
  ] as const)
    assert.equal(formatMediaTime(seconds), expected)
})

test("playback speed wraps through the supported rates", () => {
  let speed = 1
  for (const next of [1.5, 2, 1, 1.5]) {
    speed = nextPlaybackSpeed(speed)
    assert.equal(speed, next)
  }
  assert.equal(nextPlaybackSpeed(0), 1)
})

test("video preview keeps signed queries, explicit fragments and server posters intact", () => {
  const src = "https://example.test/signed?signature=a%2Bb&expires=123"
  assert.equal(videoPreviewSource(src), `${src}#t=0.001`)
  assert.equal(videoPreviewSource(`${src}#t=2`), `${src}#t=2`)
  assert.equal(videoPreviewSource(src, "https://example.test/thumb"), src)
})

test("duration badge appears only before playback and while controls are hidden", () => {
  for (const playing of [false, true])
    for (const started of [false, true])
      for (const controls of [false, true])
        assert.equal(
          showVideoDurationBadge(playing, started, controls),
          !playing && !started && !controls
        )
})

test("square video-note metadata excludes unknown, portrait and landscape frames", () => {
  assert.equal(isVideoNoteFrame(480, 480), true)
  for (const [width, height] of [
    [0, 0],
    [720, 1280],
    [1280, 720],
    [NaN, NaN],
    [Infinity, Infinity],
  ])
    assert.equal(isVideoNoteFrame(width, height), false)
})

test("focused keyboard shortcuts toggle or seek five seconds within the media", () => {
  for (const key of [" ", "k", "K"])
    assert.deepEqual(mediaKeyAction(key, 40), { type: "toggle" })
  assert.deepEqual(mediaKeyAction("ArrowLeft", 40), {
    type: "seek",
    position: 35,
  })
  assert.deepEqual(mediaKeyAction("ArrowRight", 40), {
    type: "seek",
    position: 45,
  })
  assert.equal(mediaKeyAction("Escape", 40), undefined)
  assert.equal(clampMediaTime(-5, 100), 0)
  assert.equal(clampMediaTime(105, 100), 100)
  assert.equal(clampMediaTime(45, 100), 45)
  assert.equal(clampMediaTime(45, Infinity), 0)
})

test("starting another audio pauses the first; old cleanup cannot release the new owner", () => {
  const coordinator = createAudioCoordinator()
  const pauses = [0, 0, 0]
  const players = pauses.map((_, i) => ({
    pause() {
      pauses[i]++
    },
  }))
  coordinator.claim(players[0])
  coordinator.claim(players[0])
  assert.deepEqual(pauses, [0, 0, 0])
  coordinator.claim(players[1])
  assert.deepEqual(pauses, [1, 0, 0])
  coordinator.release(players[0])
  coordinator.claim(players[2])
  assert.deepEqual(pauses, [1, 1, 0])
  coordinator.release(players[2])
  coordinator.claim(players[0])
  assert.deepEqual(pauses, [1, 1, 0])
})

test("custom players provide labeled controls and never expose native browser controls", () => {
  const src = "https://example.test/signed"
  const audio = renderToStaticMarkup(
    React.createElement(AudioPlayer, { src, compact: true })
  )
  for (const label of [
    "voice-player",
    "Play voice note",
    "Seek voice note",
    "Playback speed 1×",
  ])
    assert.ok(audio.includes(label))
  assert.doesNotMatch(audio, /<audio[^>]*controls/)
  assert.match(audio, /<audio[^>]*preload="metadata"/)
  const video = renderToStaticMarkup(React.createElement(VideoPlayer, { src }))
  for (const label of [
    "Play video",
    "Seek video",
    "Mute video",
    "Fullscreen video",
  ])
    assert.ok(video.includes(label))
  assert.doesNotMatch(video, /<video[^>]*controls/)
  assert.match(video, /<video[^>]*preload="metadata"/)
  assert.match(video, /signed#t=0\.001/)
  assert.doesNotMatch(video, /data-slot="badge"/)
  const poster = renderToStaticMarkup(
    React.createElement(VideoPlayer, { src, duration: 95, onOpen() {} })
  )
  assert.match(poster, /Open video/)
  assert.match(poster, /1:35/)
  assert.doesNotMatch(poster, /Seek video/)
  assert.match(poster, /data-slot="badge"/)
  const thumbnail = renderToStaticMarkup(
    React.createElement(VideoPlayer, {
      src,
      poster: "https://example.test/thumb",
    })
  )
  assert.match(thumbnail, /poster="https:\/\/example.test\/thumb"/)
  assert.doesNotMatch(thumbnail, /#t=/)
})
