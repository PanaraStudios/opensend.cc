"use client"

import * as React from "react"
import {
  ExpandIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import { AspectRatio } from "@/components/ui/aspect-ratio"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import {
  formatMediaTime,
  isVideoNoteFrame,
  showVideoDurationBadge,
  videoPreviewSource,
} from "@/lib/media-player"
import { useMediaPlayer } from "@/lib/use-media-player"
import { cn } from "@/lib/utils"

export type VideoPlayerProps = {
  src: string
  poster?: string
  duration?: number
  label?: string
  className?: string
  /** Fill a bounded viewer stage instead of reserving a 16:9 inline frame. */
  layout?: "inline" | "stage"
  /** WhatsApp does not flag video notes; their square metadata identifies them. */
  detectVideoNote?: boolean
  /** Poster mode opens a viewer instead of starting inline playback. */
  onOpen?: () => void
}

export function VideoPlayer(props: VideoPlayerProps) {
  return <VideoPlayerContent key={props.src} {...props} />
}

function VideoPlayerContent({
  src,
  poster,
  duration,
  label = "Video",
  className,
  layout = "inline",
  detectVideoNote = false,
  onOpen,
}: VideoPlayerProps) {
  const {
    ref,
    playing,
    started,
    loading,
    error,
    position,
    duration: mediaDuration,
    toggle,
    seek,
    onKeyDown,
    events,
  } = useMediaPlayer<HTMLVideoElement>()
  const container = React.useRef<HTMLDivElement>(null)
  const [muted, setMuted] = React.useState(false)
  const [fullscreenError, setFullscreenError] = React.useState<string>()
  const [round, setRound] = React.useState(false)
  const controlsVisible = !onOpen
  const displayDuration = mediaDuration || duration || 0
  return (
    <div
      ref={container}
      role="group"
      aria-label={`${label} player`}
      tabIndex={onOpen ? undefined : 0}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-h-0 w-full flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !round && "bg-muted",
        layout === "stage" && "h-full",
        className
      )}
      data-testid="video-player"
    >
      <AspectRatio
        ratio={round ? 1 : 16 / 9}
        className={cn(
          "flex items-center justify-center overflow-hidden",
          round ? "rounded-full" : "rounded-lg",
          layout === "stage" && "aspect-auto min-h-0 flex-1"
        )}
      >
        <video
          ref={ref}
          src={videoPreviewSource(src, poster)}
          poster={poster}
          playsInline
          preload="metadata"
          muted={muted}
          className={cn(
            "block size-full",
            round ? "object-cover" : "object-contain"
          )}
          aria-label={label}
          {...events}
          onLoadedMetadata={() => {
            events.onLoadedMetadata()
            if (detectVideoNote && layout === "inline")
              setRound(
                isVideoNoteFrame(
                  ref.current?.videoWidth ?? 0,
                  ref.current?.videoHeight ?? 0
                )
              )
          }}
        />
        {onOpen || !playing ? (
          <Button
            variant="ghost"
            className="absolute inset-0 h-full w-full"
            aria-label={onOpen ? "Open video" : "Play video"}
            onClick={onOpen ?? (() => void toggle())}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-background text-foreground shadow-sm">
              {loading ? <Spinner /> : <PlayIcon />}
            </span>
          </Button>
        ) : loading ? (
          <Spinner className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        ) : null}
        {showVideoDurationBadge(playing, started, controlsVisible) ? (
          <Badge
            variant="secondary"
            className="pointer-events-none absolute right-2 bottom-2 tabular-nums"
          >
            {formatMediaTime(displayDuration)}
          </Badge>
        ) : null}
      </AspectRatio>
      {controlsVisible ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 pb-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause video" : "Play video"}
            onClick={() => void toggle()}
          >
            {loading ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Slider
            variant="media"
            className="min-w-12 flex-1"
            aria-label="Seek video"
            value={[position]}
            min={0}
            max={mediaDuration || 1}
            step={0.1}
            disabled={!mediaDuration}
            onValueChange={(value) =>
              seek(Array.isArray(value) ? value[0] : value)
            }
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMediaTime(position)} / {formatMediaTime(displayDuration)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={muted ? "Unmute video" : "Mute video"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fullscreen video"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen()
                else if (container.current?.requestFullscreen)
                  await container.current.requestFullscreen()
                else
                  setFullscreenError(
                    "Fullscreen is unavailable in this browser."
                  )
              } catch {
                setFullscreenError("Fullscreen is unavailable in this browser.")
              }
            }}
          >
            <ExpandIcon />
          </Button>
        </div>
      ) : null}
      {error || fullscreenError ? (
        <p role="alert" className="px-2 pb-2 text-xs text-destructive">
          {error || fullscreenError}
        </p>
      ) : null}
    </div>
  )
}
