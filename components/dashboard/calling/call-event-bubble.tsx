import { PhoneIcon, PhoneMissedIcon } from "lucide-react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { callEventLabel } from "@/lib/meta/softphone"
/** Standalone thread renderer; the conversation restyle can import this later. */
export function CallEventBubble({
  status,
  duration,
  direction,
  time,
}: {
  status: string
  duration?: number | null
  direction: "inbound" | "outbound"
  time: string
}) {
  const missed = ["missed", "failed", "rejected"].includes(status)
  const Icon = missed ? PhoneMissedIcon : PhoneIcon
  return (
    <Bubble
      align={direction === "outbound" ? "end" : "start"}
      variant={direction === "outbound" ? "default" : "muted"}
    >
      <BubbleContent>
        <div className="flex items-center gap-3">
          <Icon className="shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <span>{callEventLabel(status, duration)}</span>
            <time className="text-xs text-muted-foreground">{time}</time>
          </div>
        </div>
      </BubbleContent>
    </Bubble>
  )
}
