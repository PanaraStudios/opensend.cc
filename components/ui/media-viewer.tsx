"use client"

import * as React from "react"
import { DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { VideoPlayer } from "@/components/ui/video-player"
import { cn } from "@/lib/utils"

export type MediaViewerItem = {
  id: string
  type: "image" | "video"
  src: string
  poster?: string
  duration?: number
  filename?: string
  caption?: string
  sender?: string
  at?: number
}

export function MediaViewer({
  items,
  selectedId,
  onClose,
}: {
  items: MediaViewerItem[]
  selectedId: string | null
  onClose: () => void
}) {
  const startIndex = items.findIndex((item) => item.id === selectedId)
  return (
    <Dialog
      open={startIndex >= 0}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
        {startIndex >= 0 ? (
          <ViewerSlides
            key={selectedId}
            items={items}
            startIndex={startIndex}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ViewerSlides({
  items,
  startIndex,
}: {
  items: MediaViewerItem[]
  startIndex: number
}) {
  const [api, setApi] = React.useState<CarouselApi>()
  const subscribe = React.useCallback(
    (notify: () => void) => {
      api?.on("select", notify)
      api?.on("reInit", notify)
      return () => {
        api?.off("select", notify)
        api?.off("reInit", notify)
      }
    },
    [api]
  )
  const getIndex = React.useCallback(
    () => api?.selectedScrollSnap() ?? startIndex,
    [api, startIndex]
  )
  const index = React.useSyncExternalStore(
    subscribe,
    getIndex,
    () => startIndex
  )
  const item = items[index]
  return (
    <div
      className="flex flex-col gap-4"
      onKeyDownCapture={(event) => {
        // Player arrows seek; slider arrows adjust the seek position.
        if (
          (event.target as HTMLElement).closest('[data-testid="video-player"]')
        )
          return
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          if (event.key === "ArrowLeft") api?.scrollPrev()
          else api?.scrollNext()
        }
      }}
    >
      <DialogHeader className="pr-8">
        <DialogTitle>
          {item.filename || (item.type === "video" ? "Video" : "Photo")}
        </DialogTitle>
        <DialogDescription>
          {[
            item.sender,
            item.at !== undefined
              ? new Date(item.at).toLocaleString()
              : undefined,
            `${index + 1} of ${items.length}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <Carousel
        opts={{ startIndex }}
        setApi={setApi}
        className="px-8 sm:px-12"
        aria-label="Conversation media"
        onKeyDownCapture={() => undefined}
      >
        <CarouselContent>
          {items.map((slide, i) => (
            <CarouselItem key={slide.id}>
              <div className="flex h-[min(58svh,36rem)] items-center justify-center">
                {i === index ? (
                  slide.type === "video" ? (
                    <VideoPlayer
                      src={slide.src}
                      poster={slide.poster}
                      duration={slide.duration}
                      label={slide.filename || "Video"}
                      className="max-h-full [&_video]:max-h-[45svh]"
                    />
                  ) : (
                    <ViewerImage key={slide.id} item={slide} />
                  )
                ) : null}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-0" aria-label="Previous media" />
        <CarouselNext className="right-0" aria-label="Next media" />
      </Carousel>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap">{item.caption}</p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a
              href={item.src}
              download={item.filename}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <DownloadIcon data-icon="inline-start" />
          Download
        </Button>
      </div>
    </div>
  )
}

function ViewerImage({ item }: { item: MediaViewerItem }) {
  const [zoom, setZoom] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  if (failed)
    return (
      <p role="alert" className="text-sm text-destructive">
        Image could not be loaded. Download the file or reopen it to try again.
      </p>
    )
  return (
    <div className="size-full overflow-auto">
      <Button
        type="button"
        variant="ghost"
        aria-label={zoom ? "Zoom out" : "Zoom in"}
        aria-pressed={zoom}
        className={cn(
          "h-full w-full p-0",
          zoom
            ? "h-auto min-h-full min-w-[200%] cursor-zoom-out"
            : "cursor-zoom-in"
        )}
        onClick={() => setZoom(!zoom)}
      >
        {/* Signed media must be fetched directly, without an image proxy. Full size mounts only for the active slide. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.src}
          alt={item.caption || item.filename || "Photo"}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            "object-contain",
            zoom ? "w-full" : "max-h-full max-w-full"
          )}
        />
      </Button>
    </div>
  )
}

const MediaViewerContext = React.createContext<
  ((src: string) => boolean) | null
>(null)

/** Keep the open gallery stable while live messages arrive or history is prepended. */
export function MediaViewerProvider({
  items,
  children,
}: {
  items: MediaViewerItem[]
  children: React.ReactNode
}) {
  const [selection, setSelection] = React.useState<{
    id: string
    items: MediaViewerItem[]
  } | null>(null)
  const open = React.useCallback(
    (idOrSrc: string) => {
      const item =
        items.find((item) => item.id === idOrSrc) ??
        items.find((item) => item.src === idOrSrc)
      if (!item) return false
      setSelection({ id: item.id, items })
      return true
    },
    [items]
  )
  return (
    <MediaViewerContext.Provider value={open}>
      {children}
      <MediaViewer
        items={selection?.items ?? items}
        selectedId={selection?.id ?? null}
        onClose={() => setSelection(null)}
      />
    </MediaViewerContext.Provider>
  )
}

export function useMediaViewer() {
  return React.useContext(MediaViewerContext)
}
