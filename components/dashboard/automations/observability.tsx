"use client"

import * as React from "react"
import type { DateRange } from "react-day-picker"
import { CircleStopIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  AutomationIcon,
  EventIcon,
  STEP_ICONS,
} from "@/components/dashboard/automations/shared"
import {
  WorkflowCanvas,
  WorkflowCard,
} from "@/components/dashboard/automations/workflow"
import { Stat } from "@/components/dashboard/metrics"
import {
  AutomationRunStatusBadge,
  EmptyState,
  ListPagination,
  RelativeTime,
  ResourceTable,
  Surface,
  Th,
  ToolbarFilters,
  usePagination,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  automationRuns,
  formatElapsed,
  formatRunDuration,
  runStatusRates,
  stepMetrics,
  stepSummary,
  stepTitle,
  TRIGGER_KEY,
  type StepMetrics,
} from "@/lib/dashboard/automation"
import { DEMO_NOW } from "@/lib/dashboard/data"
import { inDateRange } from "@/lib/dashboard/email-range"
import { sentenceCase } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { Automation, AutomationRun } from "@/lib/dashboard/types"

/* How the automation is doing: its runs and its numbers on the left, and on
   the right the same graph as the editor, read-only, carrying what happened
   at each step — for the selected run, or across all of them. */

const RUN_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...(["running", "completed", "failed", "cancelled"] as const).map(
    (value) => ({ value, label: sentenceCase(value) })
  ),
]

/** The clock a run is measured against. The seeded runs live on the demo's
    fixed clock; a test run is stamped with the real one. */
function runClock(run: AutomationRun): number {
  return run.startedAt > DEMO_NOW ? Date.now() : DEMO_NOW
}

/** A label over a value, inside a card of the graph. */
function CardFact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function StepFacts({
  stepKey,
  metrics,
  run,
}: {
  stepKey: string
  /** Across the runs in view; shown while no run is selected. */
  metrics: StepMetrics | undefined
  run: AutomationRun | null
}) {
  if (run) {
    const record = run.steps.find((step) => step.key === stepKey)
    if (!record) {
      return (
        <p className="text-sm text-muted-foreground">
          This run did not reach this step.
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-6">
          <CardFact label="Status">
            <AutomationRunStatusBadge status={record.status} />
          </CardFact>
          <CardFact label="Runtime">
            {record.completedAt === null
              ? "—"
              : formatElapsed(record.completedAt - record.startedAt)}
          </CardFact>
        </div>
        {record.error ? (
          <p className="text-sm text-destructive">{record.error}</p>
        ) : null}
      </div>
    )
  }
  const average = metrics?.averageMs ?? null
  return (
    <div className="flex gap-6">
      <CardFact label="Executions">{metrics?.executions ?? 0}</CardFact>
      {stepKey === TRIGGER_KEY ? null : (
        <CardFact label="Avg. runtime">
          {average === null ? "—" : formatElapsed(average)}
        </CardFact>
      )}
    </div>
  )
}

export function Observability({ automation }: { automation: Automation }) {
  const { state, cancelAutomationRun } = useDashboard()
  const [tab, setTab] = React.useState("runs")
  const [status, setStatus] = React.useState("all")
  /* All time to begin with: a test run is stamped with the real clock, which
     the demo data's rolling ranges stop short of. */
  const [range, setRange] = React.useState<DateRange | undefined>(undefined)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const runs = React.useMemo(
    () =>
      automationRuns(state.automationRuns, automation.id).filter((run) =>
        inDateRange(run.startedAt, range)
      ),
    [state.automationRuns, automation.id, range]
  )
  const rows = runs.filter((run) => status === "all" || run.status === status)
  const { pageRows, pagination } = usePagination(rows)
  const selected =
    /* From the rows in view: a run the filters hide is not selected. */
    tab === "runs" ? (rows.find((run) => run.id === selectedId) ?? null) : null
  /* One pass over the runs for everything the cards and the stats show,
     rather than one per card. */
  const { metrics, rates, sent } = React.useMemo(
    () => ({
      metrics: stepMetrics(runs),
      rates: runStatusRates(runs),
      sent: runs.reduce(
        (count, run) =>
          count +
          run.steps.filter(
            (step) => step.type === "send_email" && step.status === "completed"
          ).length,
        0
      ),
    }),
    [runs]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (next) setTab(next)
        }}
        className="min-h-0 w-full shrink-0 gap-3 overflow-y-auto lg:w-[46%]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="mr-auto">
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          <ToolbarFilters
            range={range}
            onRangeChange={setRange}
            filters={
              tab === "runs"
                ? [
                    {
                      value: status,
                      onChange: setStatus,
                      items: RUN_STATUS_ITEMS,
                      "aria-label": "Filter by status",
                    },
                  ]
                : []
            }
          />
        </div>
        <TabsContent value="runs" className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={AutomationIcon}
              title="No runs found"
              description={
                runs.length === 0 && status === "all"
                  ? "A run starts each time the trigger event arrives for a contact."
                  : "Try adjusting your filters or clearing them to see all runs."
              }
            />
          ) : (
            <>
              <ResourceTable
                headers={
                  <>
                    <Th>Contact</Th>
                    <Th>Status</Th>
                    <Th>Started</Th>
                    <Th className="text-right">Duration</Th>
                  </>
                }
              >
                {pageRows.map((run) => (
                  <TableRow
                    key={run.id}
                    data-testid="run-row"
                    data-state={
                      run.id === selected?.id ? "selected" : undefined
                    }
                    className="cursor-pointer"
                    onClick={() => setSelectedId(run.id)}
                  >
                    <TableCell className="font-medium">
                      {run.contactEmail}
                    </TableCell>
                    <TableCell>
                      <AutomationRunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <RelativeTime at={run.startedAt} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRunDuration(run, runClock(run))}
                    </TableCell>
                  </TableRow>
                ))}
              </ResourceTable>
              <ListPagination {...pagination} noun="run" />
            </>
          )}
        </TabsContent>
        <TabsContent value="metrics" className="flex flex-col gap-3">
          <Surface>
            <h2 className="text-sm font-medium">Runs</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Running" value={`${rates.running}%`} />
              <Stat label="Completed" value={`${rates.completed}%`} />
              <Stat label="Failed" value={`${rates.failed}%`} />
              <Stat label="Cancelled" value={`${rates.cancelled}%`} />
            </div>
          </Surface>
          <Surface>
            <h2 className="text-sm font-medium">Delivery</h2>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Runs" value={String(runs.length)} />
              <Stat label="Emails" value={String(sent)} />
            </div>
          </Surface>
        </TabsContent>
      </Tabs>

      <div className="flex min-h-96 min-w-0 flex-1 flex-col gap-2">
        {selected?.status === "running" ? (
          <Button
            variant="outline"
            size="sm"
            className="w-fit self-end"
            data-testid="run-stop"
            onClick={() => {
              cancelAutomationRun(selected.id)
              toast.add({ type: "success", title: "Run stopped" })
            }}
          >
            <CircleStopIcon data-icon="inline-start" />
            Stop run
          </Button>
        ) : null}
        <WorkflowCanvas
          steps={automation.steps}
          trigger={
            <WorkflowCard
              icon={EventIcon}
              title={automation.trigger || "Custom event"}
            >
              <StepFacts
                stepKey={TRIGGER_KEY}
                metrics={metrics.get(TRIGGER_KEY)}
                run={selected}
              />
            </WorkflowCard>
          }
          renderStep={(step) => (
            <WorkflowCard
              icon={STEP_ICONS[step.type]}
              title={stepTitle(step)}
              summary={stepSummary(step, state)}
            >
              <StepFacts
                stepKey={step.key}
                metrics={metrics.get(step.key)}
                run={selected}
              />
            </WorkflowCard>
          )}
        />
      </div>
    </div>
  )
}
