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

export const AUDIO_WAVEFORM_BARS = 44

/** Take absolute peaks across every channel, then normalize quiet recordings. */
export function downsampleAudioPeaks(
  channels: readonly Float32Array[],
  count = AUDIO_WAVEFORM_BARS
) {
  const length = Math.max(0, ...channels.map((channel) => channel.length))
  const peaks = Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * length) / count)
    const end = Math.max(start + 1, Math.floor(((bar + 1) * length) / count))
    let peak = 0
    for (const channel of channels)
      for (
        let sample = start;
        sample < Math.min(end, channel.length);
        sample++
      ) {
        const value = channel[sample]
        if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value))
      }
    return peak
  })
  const maximum = Math.max(0, ...peaks)
  return peaks.map((peak) => (maximum ? peak / maximum : 0))
}

/** Stable on the server and client, even when CORS or a codec blocks decoding. */
export function fallbackAudioPeaks(src: string, count = AUDIO_WAVEFORM_BARS) {
  let hash = 2166136261
  for (let i = 0; i < src.length; i++)
    hash = Math.imul(hash ^ src.charCodeAt(i), 16777619)
  return Array.from({ length: count }, () => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0
    return 0.15 + (hash / 4294967295) * 0.85
  })
}

export function audioTimeText(
  position: number,
  duration: number,
  playing: boolean
) {
  return formatMediaTime(playing || position > 0 ? position : duration)
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
