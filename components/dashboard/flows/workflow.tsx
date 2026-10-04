"use client"
import { DEFAULT_ZOOM, ZOOM_STEPS, fitZoom } from "@/lib/dashboard/flow-zoom"

import * as React from "react"
import { MinusIcon, PlusIcon, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import type { FlowBranch, FlowSlot } from "./catalog"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

/* The workflow, drawn top to bottom on a dotted canvas: the trigger, then each
   step, with the paths of a branching step side by side beneath it. The
   editor and the observability view draw the same graph with different
   cards, so the cards come in as render props. */

export function Connector({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-6 w-px shrink-0 bg-border-strong", className)}
    />
  )
}

type GraphProps<Node extends { key: string }> = {
  branches: (node: Node) => readonly FlowBranch<Node>[]
  terminal?: (node: Node) => boolean
  stacked?: boolean
  startAtFirst?: boolean
  renderStep: (step: Node) => React.ReactNode
  /** The "add step" control for a place in the graph. Without it the graph
      is read-only and the places are plain lines. */
  renderAdd?: (slot: FlowSlot) => React.ReactNode
}

export function StepList<Node extends { key: string }>({
  steps,
  parent,
  ...props
}: GraphProps<Node> & {
  steps: readonly Node[]
  parent: FlowSlot["parent"]
}) {
  const { renderStep, renderAdd } = props
  const last = steps.at(-1)
  return (
    <div
      className={cn(
        "flex flex-col items-center",
        props.stacked && "w-full min-w-0"
      )}
    >
      {steps.map((step, index) => {
        const branches = props.branches(step)
        return (
          <React.Fragment key={step.key}>
            {props.startAtFirst && !parent && index === 0 ? null : (
              <Connector />
            )}
            {renderAdd ? (
              <>
                <div className="pointer-events-auto">
                  {renderAdd({ parent, index })}
                </div>
                <Connector />
              </>
            ) : null}
            {renderStep(step)}
            {branches.length > 0 ? (
              <>
                <Connector />
                <div
                  className={cn(
                    "flex items-start",
                    props.stacked && "w-full flex-col gap-4"
                  )}
                >
                  {branches.map((branch, at) => (
                    <div
                      key={branch.id}
                      className={cn(
                        "relative flex min-w-64 flex-col items-center px-4",
                        props.stacked && "w-full min-w-0 px-0"
                      )}
                    >
                      {/* The crossbar, from the first path's centre to the
                          last's. Set by position: paths nest, so a variant
                          keyed on an ancestor would match the outer path. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-0 top-0 h-px bg-border-strong",
                          at === 0 && "left-1/2",
                          at === branches.length - 1 && "right-1/2",
                          props.stacked && "hidden"
                        )}
                      />
                      <Connector className="h-4" />
                      {branch.label ? (
                        <Badge variant="secondary">{branch.label}</Badge>
                      ) : null}
                      <StepList
                        {...props}
                        steps={branch.steps}
                        parent={{ key: step.key, branch: branch.id }}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </React.Fragment>
        )
      })}
      {/* Nothing follows a step that branches: what comes next belongs to
          one path or the other. */}
      {!renderAdd ||
      (last &&
        (props.branches(last).length > 0 || props.terminal?.(last))) ? null : (
        <>
          <Connector />
          <div className="pointer-events-auto">
            {renderAdd({ parent, index: steps.length })}
          </div>
        </>
      )}
    </div>
  )
}

export function WorkflowCanvas<Node extends { key: string }>({
  trigger,
  steps,
  stacked: requestedStacked,
  ...props
}: GraphProps<Node> & {
  /** The first card. */
  trigger: React.ReactNode
  steps: readonly Node[]
}) {
  const mobile = useIsMobile()
  const stacked = requestedStacked ?? mobile
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM)
  const [fitted, setFitted] = React.useState(0)
  const canvas = React.useRef<HTMLDivElement>(null)
  const graph = React.useRef<HTMLDivElement>(null)
  /* Open the desktop graph zoomed to fit its width (never above 100%), and the
     mobile stack at the left edge. Only when switching layouts; otherwise keep
     the reader's zoom and pan. */
  React.useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    if (stacked) {
      element.scrollLeft = 0
      return
    }
    const natural =
      Math.max(
        0,
        ...Array.from(graph.current?.children ?? []).map(
          (child) => child.getBoundingClientRect().width
        )
      ) / ZOOM_STEPS[DEFAULT_ZOOM]
    setZoom(fitZoom(natural, element.clientWidth))
    setFitted((count) => count + 1)
  }, [stacked])
  /* Centre the fitted graph once its zoom has rendered. */
  React.useLayoutEffect(() => {
    const element = canvas.current
    if (element && fitted)
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
  }, [fitted])

  /* Dragging the background moves the canvas. The graph lets presses through
     everywhere but its cards and controls, so a press reaches the canvas only
     where there is nothing to press; a menu a card opened is portaled out of
     the canvas, and never is the target. */
  const drag = React.useRef<{ x: number; y: number } | null>(null)
  const endPan = () => {
    drag.current = null
  }

  return (
    /* The zoom control sits on the frame, not in what scrolls. */
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={canvas}
        data-testid="workflow"
        /* The graph is always larger than the frame (see below), so the
           canvas always scrolls: dragging and the wheel move it, and its
           scrollbars stay hidden. */
        className={cn(
          "min-h-0 min-w-0 flex-1 cursor-grab touch-none [scrollbar-width:none] overflow-auto rounded-xl border border-border bg-muted/40 bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:24px_24px] active:cursor-grabbing [&::-webkit-scrollbar]:hidden",
          stacked && "touch-auto"
        )}
        onPointerDown={(event) => {
          if (
            stacked ||
            event.button !== 0 ||
            event.target !== event.currentTarget
          )
            return
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          event.currentTarget.scrollLeft -= event.clientX - drag.current.x
          event.currentTarget.scrollTop -= event.clientY - drag.current.y
          drag.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          /* Larger than the frame even when the graph is small, so there is
             always canvas to drag around. */
          className={cn(
            "pointer-events-none mx-auto flex min-h-[150%] w-max min-w-[150%] flex-col items-center p-10",
            stacked && "min-h-full w-full min-w-0 p-4"
          )}
          ref={graph}
          style={{ zoom: stacked ? 1 : ZOOM_STEPS[zoom] }}
        >
          {trigger}
          <StepList {...props} stacked={stacked} steps={steps} parent={null} />
        </div>
      </div>
      <ButtonGroup
        orientation="vertical"
        className={cn("absolute top-3 right-5 z-10", stacked && "hidden")}
      >
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={zoom === ZOOM_STEPS.length - 1}
          onClick={() => setZoom((level) => level + 1)}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          disabled={zoom === 0}
          onClick={() => setZoom((level) => level - 1)}
        >
          <MinusIcon />
        </Button>
      </ButtonGroup>
    </div>
  )
}

/** A card of the graph: an icon, a name, an optional line under it, and a
    body. The editor shows the body of the card that is selected; the
    observability view shows every card's. */
export function WorkflowCard({
  icon: Icon,
  title,
  summary,
  actions,
  tone,
  selected,
  onSelect,
  children,
  "data-testid": testId,
}: {
  icon: LucideIcon
  title: string
  summary?: string | null
  actions?: React.ReactNode
  /** A card with work left reads as a warning. */
  selected?: boolean
  tone?: "warning"
  onSelect?: () => void
  children?: React.ReactNode
  "data-testid"?: string
}) {
  const heading = (
    <>
      <span className="icon-tile size-8 rounded-lg [&_svg]:size-4">
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-medium">{title}</span>
        {summary ? (
          <span className="truncate text-caption text-muted-foreground">
            {summary}
          </span>
        ) : null}
      </span>
    </>
  )
  return (
    <div
      data-testid={testId}
      className={cn(
        "pointer-events-auto flex w-96 max-w-full cursor-auto flex-col gap-3 rounded-xl border bg-card p-3 shadow-card",
        tone === "warning" ? "border-warning" : "border-border",
        selected && "ring-2 ring-ring"
      )}
    >
      <div className="flex items-center gap-1">
        {onSelect ? (
          <button
            type="button"
            aria-label={title}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={onSelect}
          >
            {heading}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {heading}
          </div>
        )}
        {actions}
      </div>
      {children}
    </div>
  )
}
