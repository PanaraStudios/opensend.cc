"use client"

import * as React from "react"
import { MicIcon, PauseIcon, PlayIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatMediaTime, nextPlaybackSpeed } from "@/lib/media-player"
import { useMediaPlayer } from "@/lib/use-media-player"
import { cn } from "@/lib/utils"

export type AudioPlayerProps = {
  src: string
  label?: string
  compact?: boolean
  avatar?: React.ReactNode
  className?: string
}

export function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayerContent key={props.src} {...props} />
}

function AudioPlayerContent({
  src,
  label = "Audio",
  compact = false,
  avatar,
  className,
}: AudioPlayerProps) {
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
  } = useMediaPlayer<HTMLAudioElement>(true)
  const [speed, setSpeed] = React.useState(1)
  return (
    <div
      className={cn(
        "flex w-72 max-w-full flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      <div className="flex items-center gap-2">
        {compact
          ? (avatar ?? (
              <Avatar>
                <AvatarFallback>
                  <MicIcon />
                </AvatarFallback>
              </Avatar>
            ))
          : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${playing ? "Pause" : "Play"} ${compact ? "voice note" : "audio"}`}
          onClick={() => void toggle()}
        >
          {loading ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Slider
            variant="media"
            aria-label={`Seek ${compact ? "voice note" : "audio"}`}
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
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
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
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
