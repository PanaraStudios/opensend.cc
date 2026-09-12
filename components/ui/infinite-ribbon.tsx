import * as React from "react"

import { cn } from "@/lib/utils"

interface InfiniteRibbonProps extends React.HTMLAttributes<HTMLDivElement> {
  repeat?: number
  duration?: number
  reverse?: boolean
  rotation?: number
  children: React.ReactNode
  className?: string
}

export function InfiniteRibbon({
  repeat = 5,
  duration = 10,
  reverse = false,
  rotation = 0,
  children,
  className,
  style,
  ...props
}: InfiniteRibbonProps) {
  const animationClass = reverse
    ? "animate-infinite-ribbon-reverse"
    : "animate-infinite-ribbon"

  return (
    <div
      className={cn(
        "max-w-full overflow-hidden bg-muted py-1 text-body text-foreground",
        className
      )}
      style={{ transform: `rotate(${rotation}deg)`, ...style }}
      {...props}
    >
      <div
        className={cn("flex w-max whitespace-nowrap", animationClass)}
        style={{ "--ribbon-duration": `${duration}s` } as React.CSSProperties}
      >
        {[0, 1].map((set) => (
          <div key={set} aria-hidden={set === 1} className="flex">
            {Array.from({ length: repeat }, (_, index) => (
              <span key={index} className="mr-8 inline-block select-none">
                {children}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
