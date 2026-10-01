"use client"
import { getImageProps, type ImageProps } from "next/image"
import * as React from "react"
import {
  DownloadIcon,
  FileTextIcon,
  PauseIcon,
  PlayIcon,
  MicIcon,
} from "lucide-react"
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
} from "@/components/ui/attachment"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { audioTime, safeMessageUrl } from "@/lib/dashboard/conversation-content"
import { cn } from "@/lib/utils"
import type { ThreadMessage } from "@/lib/messages/use-messages"

/** Use Next's public image-props helper and keep signed/animated media unoptimized. */
export function ConversationImage(props: ImageProps) {
  const { props: imageProps } = getImageProps({ ...props, unoptimized: true })
  // eslint-disable-next-line @next/next/no-img-element -- Signed media is fetched directly, with Next's dimensions and lazy-loading attributes.
  return <img {...imageProps} />
}

type File = NonNullable<ThreadMessage["normalized"]>["attachments"][number]
/** Signed channel media URLs are hydrated by the same helper used by REST/events. */
export function ConversationMedia({
  file,
  type,
  voice = false,
  pages,
}: {
  file?: File
  type: string
  voice?: boolean
  pages?: number
}) {
  const src = safeMessageUrl(file?.download_url)
  const [failed, setFailed] = React.useState(false)
  if (!src || failed || file?.error)
    return (
      <div
        className={cn(
          "chat-media-placeholder",
          type === "sticker" && "size-36"
        )}
      >
        {!file?.error && !failed ? <Skeleton className="h-12 w-full" /> : null}
        <span className="text-xs">
          {file?.error ||
            (failed ? "Media could not be loaded" : "Media is processing")}
        </span>
      </div>
    )
  if (type === "image" || type === "sticker") {
    // Authenticated signed URLs are intentionally served without Next's image proxy.
    const picture = (
      <ConversationImage
        unoptimized
        width={640}
        height={480}
        src={src}
        alt={type === "sticker" ? "Sticker" : file?.filename || "Photo"}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("chat-image", type === "sticker" && "chat-sticker")}
      />
    )
    if (type === "sticker") return picture
    return (
      <Dialog>
        <DialogTrigger
          className="block w-full cursor-zoom-in"
          aria-label="Open photo"
        >
          {picture}
        </DialogTrigger>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>Photo</DialogTitle>
          <ConversationImage
            unoptimized
            width={640}
            height={480}
            src={src}
            alt={file?.filename || "Photo"}
            className="max-h-[75svh] w-full object-contain"
          />{" "}
        </DialogContent>
      </Dialog>
    )
  }
  if (type === "video")
    return (
      <video
        src={src}
        controls
        playsInline
        preload="none"
        className="chat-video"
        aria-label="Video"
        onError={() => setFailed(true)}
      />
    )
  if (type === "audio")
    return voice ? (
      <VoicePlayer src={src} onError={() => setFailed(true)} />
    ) : (
      <div className="flex w-72 max-w-full flex-col gap-1">
        <span className="text-xs">{file?.filename || "Audio"}</span>
        <audio
          src={src}
          controls
          preload="none"
          className="w-full"
          onError={() => setFailed(true)}
          aria-label="Audio"
        />
      </div>
    )
  return (
    <Attachment className="w-72 max-w-full">
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{file?.filename || "Document"}</AttachmentTitle>
        <AttachmentDescription>
          {[
            pages ? `${pages} pages` : null,
            file?.content_type,
            file?.size ? `${Math.ceil(file.size / 1024)} kB` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </AttachmentDescription>
      </AttachmentContent>
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        render={
          <a
            href={src}
            download={file?.filename ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          />
        }
        aria-label="Download document"
      >
        <DownloadIcon />
      </Button>
    </Attachment>
  )
}
function VoicePlayer({ src, onError }: { src: string; onError: () => void }) {
  const audio = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [position, setPosition] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  React.useEffect(() => {
    const element = audio.current
    if (!element?.parentElement) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          element.preload = "metadata"
          element.load()
          observer.disconnect()
        }
      },
      { rootMargin: "100px" }
    )
    observer.observe(element.parentElement)
    return () => observer.disconnect()
  }, [src])
  return (
    <div
      className="flex w-72 max-w-full items-center gap-2"
      data-testid="voice-player"
    >
      <Avatar>
        <AvatarFallback>
          <MicIcon className="size-5" />
        </AvatarFallback>
      </Avatar>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onError={onError}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audio.current?.duration ?? 0)}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={() => {
          if (playing) audio.current?.pause()
          else void audio.current?.play().catch(onError)
        }}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="chat-waveform" aria-hidden="true">
          {Array.from({ length: 36 }, (_, i) => (
            <span
              key={i}
              style={{ height: `${20 + ((i * 17 + 13) % 75)}%` }}
              data-played={duration > 0 && i / 36 <= position / duration}
            />
          ))}
        </div>
        <input
          type="range"
          className="chat-seek"
          aria-label="Seek voice note"
          min={0}
          max={Number.isFinite(duration) ? duration : 0}
          step="0.1"
          value={position}
          onChange={(event) => {
            if (audio.current)
              audio.current.currentTime = Number(event.target.value)
          }}
        />
        <span className="text-xs opacity-70">
          {audioTime(playing ? position : duration)}
        </span>
      </div>
    </div>
  )
}
