"use client"

import * as React from "react"
import {
  clampMediaTime,
  createAudioCoordinator,
  mediaKeyAction,
} from "./media-player"

const audioCoordinator = createAudioCoordinator()

/** Native media events are the source of truth, including external pauses. */
export function useMediaPlayer<T extends HTMLMediaElement>(exclusive = false) {
  const ref = React.useRef<T>(null)
  const [playing, setPlaying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [position, setPosition] = React.useState(0)
  const [duration, setDuration] = React.useState(0)

  React.useEffect(() => {
    const media = ref.current
    if (!media) return
    // Fetch metadata only once the player is near the viewport.
    const load = () => {
      if (media.preload === "none") {
        media.preload = "metadata"
        media.load()
      }
    }
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                load()
                observer?.disconnect()
              }
            },
            { rootMargin: "100px" }
          )
        : undefined
    if (observer) observer.observe(media.parentElement ?? media)
    else load()
    return () => {
      observer?.disconnect()
      media.pause()
      if (exclusive) audioCoordinator.release(media)
    }
  }, [exclusive])

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
    onLoadedMetadata() {
      setLoading(false)
    },
    onPlay() {
      if (exclusive && ref.current) audioCoordinator.claim(ref.current)
      setPlaying(true)
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
    },
    onWaiting() {
      setLoading(true)
    },
    onCanPlay() {
      setLoading(false)
    },
    onError: fail,
    onTimeUpdate() {
      setPosition(ref.current?.currentTime ?? 0)
    },
    onDurationChange() {
      const value = ref.current?.duration ?? 0
      setDuration(Number.isFinite(value) ? value : 0)
    },
  }
  return {
    ref,
    playing,
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
