"use client"

import * as React from "react"
import {
  clampMediaTime,
  createAudioCoordinator,
  mediaKeyAction,
} from "./media-player"

const audioCoordinator = createAudioCoordinator()

/** Native media events are the source of truth, including external pauses. */
export function useMediaPlayer<T extends HTMLMediaElement>(
  exclusive = false,
  { resetOnEnd = false }: { resetOnEnd?: boolean } = {}
) {
  const ref = React.useRef<T>(null)
  const [playing, setPlaying] = React.useState(false)
  const [started, setStarted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [position, setPosition] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const probing = React.useRef(false)

  const updateDuration = React.useCallback(() => {
    const media = ref.current
    const value = media?.duration ?? 0
    if (!Number.isFinite(value)) return setDuration(0)
    setDuration(value)
    if (media && probing.current) {
      probing.current = false
      media.currentTime = 0
    }
  }, [])

  const resolveMetadata = React.useCallback(() => {
    const media = ref.current
    // Ogg/Opus voice notes (WhatsApp) carry no duration header, so Chrome reports
    // Infinity until the end is read. Seeking past the end makes it resolve.
    if (media?.duration === Infinity && !probing.current) {
      probing.current = true
      media.currentTime = Number.MAX_SAFE_INTEGER
    }
    updateDuration()
    setLoading(false)
  }, [updateDuration])

  React.useEffect(() => {
    const media = ref.current
    if (!media) return
    let mounted = true
    // Cached metadata can load before hydration attaches React's event handlers.
    queueMicrotask(() => {
      if (mounted && media.readyState >= 1) resolveMetadata()
    })
    return () => {
      mounted = false
      media.pause()
      if (exclusive) audioCoordinator.release(media)
    }
  }, [exclusive, resolveMetadata])

  function fail() {
    setError("Media could not be played. Try again or download the file.")
    setLoading(false)
    setPlaying(false)
  }
  async function toggle() {
    const media = ref.current
    if (!media) return
    if (!media.paused) media.pause()
    else {
      setError(undefined)
      setLoading(true)
      if (media.error) media.load()
      try {
        await media.play()
      } catch {
        fail()
      }
    }
  }
  function seek(value: number) {
    if (!ref.current || !duration) return
    const time = clampMediaTime(value, duration)
    ref.current.currentTime = time
    setPosition(time)
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    // Preserve a control's own keyboard semantics (buttons and seek slider).
    if (event.target !== event.currentTarget) return
    const action = mediaKeyAction(event.key, position)
    if (action?.type === "toggle") {
      event.preventDefault()
      void toggle()
    } else if (action?.type === "seek") {
      event.preventDefault()
      event.stopPropagation()
      seek(action.position)
    }
  }
  const events = {
    onLoadStart() {
      setLoading(true)
    },
    onLoadedMetadata: resolveMetadata,
    onPlay() {
      if (exclusive && ref.current) audioCoordinator.claim(ref.current)
      setPlaying(true)
      setStarted(true)
    },
    onPlaying() {
      setLoading(false)
    },
    onPause() {
      setPlaying(false)
      setLoading(false)
    },
    onEnded() {
      setPlaying(false)
      setLoading(false)
      if (resetOnEnd && ref.current && !probing.current) {
        ref.current.currentTime = 0
        setPosition(0)
        setStarted(false)
      }
    },
    onWaiting() {
      setLoading(true)
    },
    onCanPlay() {
      setLoading(false)
    },
    onError: fail,
    onTimeUpdate() {
      if (!probing.current) setPosition(ref.current?.currentTime ?? 0)
    },
    onDurationChange: updateDuration,
  }
  return {
    ref,
    playing,
    started,
    loading,
    error,
    position,
    duration,
    toggle,
    seek,
    onKeyDown,
    events,
  }
}
