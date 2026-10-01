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
import { formatMediaTime } from "@/lib/media-player"
import { useMediaPlayer } from "@/lib/use-media-player"
import { cn } from "@/lib/utils"

export type VideoPlayerProps = {
  src: string
  poster?: string
  duration?: number
  label?: string
  className?: string
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
  onOpen,
}: VideoPlayerProps) {
  const {
    ref,
    playing,
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
  return (
    <div
      ref={container}
      role="group"
      aria-label={`${label} player`}
      tabIndex={onOpen ? undefined : 0}
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      data-testid="video-player"
    >
      <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-lg">
        <video
          ref={ref}
          src={src}
          poster={poster}
          playsInline
          preload="none"
          muted={muted}
          className="size-full object-contain"
          aria-label={label}
          {...events}
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
          <Spinner className="absolute top-1/2 left-1/2" />
        ) : null}
        <Badge
          variant="secondary"
          className="pointer-events-none absolute right-2 bottom-2 tabular-nums"
        >
          {formatMediaTime(mediaDuration || duration || 0)}
        </Badge>
      </AspectRatio>
      {!onOpen ? (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause video" : "Play video"}
            onClick={() => void toggle()}
          >
            {loading ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Slider
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
            {formatMediaTime(position)} / {formatMediaTime(mediaDuration)}
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
