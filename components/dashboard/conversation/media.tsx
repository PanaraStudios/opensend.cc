"use client"
import { getImageProps, type ImageProps } from "next/image"
import * as React from "react"
import { DownloadIcon, FileTextIcon } from "lucide-react"
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { AudioPlayer } from "@/components/ui/audio-player"
import { VideoPlayer } from "@/components/ui/video-player"
import { AspectRatio } from "@/components/ui/aspect-ratio"
import {
  MediaViewer,
  useMediaViewer,
  type MediaViewerItem,
} from "@/components/ui/media-viewer"
import { Skeleton } from "@/components/ui/skeleton"
import { safeMessageUrl } from "@/lib/dashboard/conversation-content"
import { cn } from "@/lib/utils"
import type { ThreadMessage } from "@/lib/messages/use-messages"

/** Use Next's public image-props helper and keep signed/animated media unoptimized. */
export function ConversationImage(props: ImageProps) {
  const { props: imageProps } = getImageProps({ ...props, unoptimized: true })
  // eslint-disable-next-line @next/next/no-img-element -- Signed media is fetched directly, with Next's dimensions and lazy-loading attributes.
  return <img {...imageProps} alt={props.alt} />
}

type File = NonNullable<ThreadMessage["normalized"]>["attachments"][number]
/** Signed channel media URLs are hydrated by the same helper used by REST/events. */
export function ConversationMedia({
  file,
  type,
  voice = false,
  pages,
  url,
  label,
  viewerId,
}: {
  file?: File
  type: string
  voice?: boolean
  pages?: number
  url?: string
  label?: string
  viewerId?: string
}) {
  const src = safeMessageUrl(file?.download_url ?? url)
  const [failed, setFailed] = React.useState(false)
  const [viewerOpen, setViewerOpen] = React.useState(false)
  const gallery = useMediaViewer()
  function open() {
    if (src && !gallery?.(viewerId ?? src)) setViewerOpen(true)
  }
  const item: MediaViewerItem = {
    id: src || "media",
    src: src || "",
    type: type === "video" ? "video" : "image",
    filename: file?.filename ?? label,
  }
  const viewer = (
    <MediaViewer
      items={[item]}
      selectedId={viewerOpen ? item.id : null}
      onClose={() => setViewerOpen(false)}
    />
  )
  if (!src || failed || file?.error)
    return (
      <div
        className={cn(
          "flex w-72 max-w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted p-4 text-muted-foreground",
          type === "sticker" && "size-36",
          type === "image" && "aspect-[4/3]",
          type === "video" && "aspect-video"
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
    const picture = (
      <ConversationImage
        width={640}
        height={480}
        src={src}
        alt={
          type === "sticker" ? "Sticker" : file?.filename || label || "Photo"
        }
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(
          "size-full object-contain",
          type === "sticker" && "size-36"
        )}
      />
    )
    if (type === "sticker") return picture
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          className="block h-auto w-72 max-w-full cursor-zoom-in p-0"
          aria-label="Open photo"
          onClick={open}
        >
          <AspectRatio ratio={4 / 3} className="overflow-hidden rounded-lg">
            {picture}
          </AspectRatio>
        </Button>
        {viewer}
      </>
    )
  }
  if (type === "video")
    return (
      <>
        <VideoPlayer src={src} onOpen={open} className="w-72 max-w-full" />
        {viewer}
      </>
    )
  if (type === "audio")
    return (
      <AudioPlayer
        src={src}
        compact={voice}
        label={voice ? "Voice note" : file?.filename || "Audio"}
      />
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
