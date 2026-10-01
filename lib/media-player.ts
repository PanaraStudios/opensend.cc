/** Shared by audio and video controls, including unknown/live durations. */
export function formatMediaTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = String(value % 60).padStart(2, "0")
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`
}

/** Preserve signed URLs and caller-provided fragments; thumbnails take priority. */
export function videoPreviewSource(src: string, poster?: string) {
  return poster || src.includes("#") ? src : `${src}#t=0.001`
}

export function showVideoDurationBadge(
  playing: boolean,
  started: boolean,
  controlsVisible: boolean
) {
  return !playing && !started && !controlsVisible
}

/** WhatsApp video notes have square frames, with the circle encoded in the video. */
export function isVideoNoteFrame(width: number, height: number) {
  return width > 0 && Number.isFinite(width) && width === height
}

export function nextPlaybackSpeed(speed: number) {
  const speeds = [1, 1.5, 2]
  return speeds[(speeds.indexOf(speed) + 1) % speeds.length]
}

export function clampMediaTime(position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return 0
  return Math.max(0, Math.min(position, duration))
}

export function mediaKeyAction(key: string, position: number) {
  if ([" ", "k", "K"].includes(key)) return { type: "toggle" } as const
  if (key === "ArrowLeft" || key === "ArrowRight")
    return {
      type: "seek",
      position: position + (key === "ArrowLeft" ? -5 : 5),
    } as const
}

/** One owner across all mounted audio players; releasing an old owner is safe. */
export function createAudioCoordinator() {
  let active: { pause: () => void } | undefined
  return {
    claim(player: { pause: () => void }) {
      if (active !== player) active?.pause()
      active = player
    },
    release(player: { pause: () => void }) {
      if (active === player) active = undefined
    },
  }
}
