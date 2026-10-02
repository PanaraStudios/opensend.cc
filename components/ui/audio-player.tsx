"use client"

import * as React from "react"
import { MicIcon, PauseIcon, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  audioTimeText,
  downsampleAudioPeaks,
  fallbackAudioPeaks,
  formatMediaTime,
  nextPlaybackSpeed,
} from "@/lib/media-player"
import { useMediaPlayer } from "@/lib/use-media-player"
import { cn } from "@/lib/utils"

// Cache the promise too: duplicate bubbles share a single fetch/decode, including
// failures. Only small peak arrays remain once the bytes and AudioBuffer are freed.
const waveformCache = new Map<string, Promise<number[]>>()

function audioPeaks(src: string) {
  let pending = waveformCache.get(src)
  if (!pending) {
    pending = (async () => {
      let context: AudioContext | undefined
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error("Audio could not be fetched")
        const bytes = await response.arrayBuffer()
        context = new AudioContext()
        const buffer = await context.decodeAudioData(bytes)
        return downsampleAudioPeaks(
          Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
            buffer.getChannelData(channel)
          )
        )
      } catch {
        return fallbackAudioPeaks(src)
      } finally {
        if (context) void context.close().catch(() => {})
      }
    })()
    waveformCache.set(src, pending)
  }
  return pending
}

export type AudioPlayerProps = {
  src: string
  label?: string
  compact?: boolean
  className?: string
}

export function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayerContent key={props.src} {...props} />
}

function AudioPlayerContent({
  src,
  label = "Audio",
  compact = false,
  className,
}: AudioPlayerProps) {
  const {
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
  } = useMediaPlayer<HTMLAudioElement>(true, { resetOnEnd: true })
  const root = React.useRef<HTMLDivElement>(null)
  const [speed, setSpeed] = React.useState(1)
  const [peaks, setPeaks] = React.useState(() => fallbackAudioPeaks(src))
  const kind = compact ? "voice note" : "audio"

  React.useEffect(() => {
    let mounted = true
    let requested = false
    function loadWaveform() {
      if (requested) return
      requested = true
      void audioPeaks(src).then((decoded) => {
        if (mounted) setPeaks(decoded)
      })
    }
    const media = ref.current
    media?.addEventListener("loadedmetadata", loadWaveform)
    if (media?.readyState) loadWaveform()
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              loadWaveform()
              observer?.disconnect()
            }
          })
    if (root.current) observer?.observe(root.current)
    if (!observer) loadWaveform()
    return () => {
      mounted = false
      observer?.disconnect()
      media?.removeEventListener("loadedmetadata", loadWaveform)
    }
  }, [src, ref])

  return (
    <div
      ref={root}
      className={cn(
        "flex w-72 max-w-full min-w-0 flex-col gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      role="group"
      tabIndex={0}
      aria-label={`${label} player`}
      onKeyDown={onKeyDown}
      data-testid={compact ? "voice-player" : "audio-player"}
    >
      <audio ref={ref} src={src} preload="metadata" {...events} />
      {!compact ? <span className="truncate text-xs">{label}</span> : null}
      <div className="flex h-8 min-w-0 items-center gap-2">
        <div className="relative shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  className="rounded-full"
                  aria-label={`${playing ? "Pause" : "Play"} ${kind}`}
                  aria-busy={loading}
                  onClick={() => void toggle()}
                />
              }
            >
              {loading ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon />}
            </TooltipTrigger>
            <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>
          {compact ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <MicIcon className="size-2.5" />
            </span>
          ) : null}
        </div>
        <Waveform
          peaks={peaks}
          position={position}
          duration={duration}
          label={`Seek ${kind}`}
          seek={seek}
          onKeyDown={onKeyDown}
        />
        <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="secondary"
                  size="xs"
                  className="rounded-full"
                  aria-label={`Playback speed ${speed}×`}
                  onClick={() => {
                    const next = nextPlaybackSpeed(speed)
                    setSpeed(next)
                    if (ref.current) ref.current.playbackRate = next
                  }}
                />
              }
            >
              {speed}×
            </TooltipTrigger>
            <TooltipContent>Change playback speed</TooltipContent>
          </Tooltip>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {audioTimeText(position, duration, playing)}
        </span>
      </div>
      {error ? (
        <div role="alert" className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            Audio could not be played.
          </span>
          <Button
            variant="link"
            size="xs"
            aria-label={`Retry ${kind}`}
            onClick={() => void toggle()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Waveform({
  peaks,
  position,
  duration,
  label,
  seek,
  onKeyDown,
}: {
  peaks: number[]
  position: number
  duration: number
  label: string
  seek: (position: number) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}) {
  function seekPointer(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width && duration)
      seek(((event.clientX - bounds.left) / bounds.width) * duration)
  }
  return (
    <div className="@container/waveform min-w-0 flex-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={position}
        aria-valuetext={`${formatMediaTime(position)} of ${formatMediaTime(duration)}`}
        aria-disabled={!duration}
        className="flex h-8 w-full touch-none items-center justify-between gap-[min(2px,1cqw)] rounded-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault()
            event.stopPropagation()
            seek(event.key === "Home" ? 0 : duration)
          } else onKeyDown(event)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !duration) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          seekPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            seekPointer(event)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            seekPointer(event)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      >
        {peaks.map((peak, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "max-w-[3px] min-w-0 flex-1 rounded-full",
              duration > 0 && index / peaks.length < position / duration
                ? "bg-foreground"
                : "bg-muted-foreground/40"
            )}
            style={{ height: `${4 + peak * 24}px` }}
          />
        ))}
      </div>
    </div>
  )
}
