"use client"

import * as React from "react"
import { MinusIcon, PlusIcon, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { stepBranches, type StepSlot } from "@/lib/dashboard/automation"
import type { AutomationStep } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

/* The workflow, drawn top to bottom on a dotted canvas: the trigger, then each
   step, with the paths of a branching step side by side beneath it. The
   editor and the observability view draw the same graph with different
   cards, so the cards come in as render props. */

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25] as const

function Connector({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-6 w-px shrink-0 bg-border-strong", className)}
    />
  )
}

type GraphProps = {
  renderStep: (step: AutomationStep) => React.ReactNode
  /** The "add step" control for a place in the graph. Without it the graph
      is read-only and the places are plain lines. */
  renderAdd?: (slot: StepSlot) => React.ReactNode
}

function StepList({
  steps,
  parent,
  ...props
}: GraphProps & {
  steps: readonly AutomationStep[]
  parent: StepSlot["parent"]
}) {
  const { renderStep, renderAdd } = props
  const last = steps.at(-1)
  return (
    <div className="flex flex-col items-center">
      {steps.map((step, index) => {
        const branches = stepBranches(step)
        return (
          <React.Fragment key={step.key}>
            <Connector />
            {renderAdd ? (
              <>
                {renderAdd({ parent, index })}
                <Connector />
              </>
            ) : null}
            {renderStep(step)}
            {branches.length > 0 ? (
              <>
                <Connector />
                <div className="flex items-start">
                  {branches.map((branch, at) => (
                    <div
                      key={branch.id}
                      className="relative flex min-w-64 flex-col items-center px-4"
                    >
                      {/* The crossbar, from the first path's centre to the
                          last's. Set by position: paths nest, so a variant
                          keyed on an ancestor would match the outer path. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-0 top-0 h-px bg-border-strong",
                          at === 0 && "left-1/2",
                          at === branches.length - 1 && "right-1/2"
                        )}
                      />
                      <Connector className="h-4" />
                      <Badge variant="secondary">{branch.label}</Badge>
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
      {!renderAdd || (last && stepBranches(last).length > 0) ? null : (
        <>
          <Connector />
          {renderAdd({ parent, index: steps.length })}
        </>
      )}
    </div>
  )
}

export function WorkflowCanvas({
  trigger,
  steps,
  className,
  ...props
}: GraphProps & {
  /** The first card. Null while the automation has no trigger yet. */
  trigger: React.ReactNode
  steps: readonly AutomationStep[]
  className?: string
}) {
  const [zoom, setZoom] = React.useState(2)
  const canvas = React.useRef<HTMLDivElement>(null)
  /* A graph wider than the canvas opens on its middle, where the trigger is,
     rather than on its left edge. */
  React.useLayoutEffect(() => {
    const element = canvas.current
    if (element) {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
    }
  }, [zoom])

  /* Dragging the background moves the canvas. A drag that starts on a card
     or a control is left to it. */
  const drag = React.useRef<{ x: number; y: number } | null>(null)
  const [panning, setPanning] = React.useState(false)

  return (
    /* The zoom control sits on the frame, not in what scrolls. */
    <div className={cn("relative flex min-h-0 flex-1", className)}>
      <div
        ref={canvas}
        data-testid="workflow"
        className={cn(
          "min-h-0 flex-1 touch-none overflow-auto rounded-xl border border-border bg-muted/40 bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] [background-size:24px_24px]",
          panning ? "cursor-grabbing select-none" : "cursor-grab"
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = event.target as HTMLElement
          /* React bubbles events out of portals, so a press inside a menu or
             a select list that a card opened arrives here too. Only a press
             on the canvas itself, outside every card, starts a pan. */
          if (
            !event.currentTarget.contains(target) ||
            target.closest("[data-workflow-card]")
          ) {
            return
          }
          drag.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
          setPanning(true)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          event.currentTarget.scrollLeft -= event.clientX - drag.current.x
          event.currentTarget.scrollTop -= event.clientY - drag.current.y
          drag.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={() => {
          drag.current = null
          setPanning(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setPanning(false)
        }}
      >
        <div
          /* Larger than the frame even when the graph is small, so there is
             always canvas to drag around. */
          className="mx-auto flex min-h-[150%] w-max min-w-[150%] flex-col items-center p-10"
          style={{ zoom: ZOOM_STEPS[zoom] }}
        >
          {trigger}
          <StepList {...props} steps={steps} parent={null} />
        </div>
      </div>
      <ButtonGroup
        orientation="vertical"
        className="absolute top-3 right-5 z-10"
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
  onSelect,
  children,
  "data-testid": testId,
}: {
  icon: LucideIcon
  title: string
  summary?: string | null
  actions?: React.ReactNode
  /** A card with work left reads as a warning. */
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
      data-workflow-card=""
      className={cn(
        "flex w-96 max-w-full cursor-auto flex-col gap-3 rounded-xl border bg-card p-3 shadow-card",
        tone === "warning" ? "border-warning" : "border-border"
      )}
    >
      <div className="flex items-center gap-1">
        {onSelect ? (
          <button
            type="button"
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
