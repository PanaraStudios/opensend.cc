"use client"

import * as React from "react"
import { CircleHelpIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  STATUS_ITEMS,
  isFilterableStatus,
} from "@/components/dashboard/emails/shared"
import {
  PageHeader,
  Surface,
  ToolbarFilters,
  emailStatusColor,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { defaultEmailRange } from "@/lib/dashboard/email-range"
import {
  EMAIL_STATUS_TONE,
  emailStatusLabel,
  percent,
  type BadgeTone,
} from "@/lib/dashboard/format"
import {
  BOUNCE_RISK,
  COMPLAIN_RISK,
  senderDomain,
  summarizeEmails,
  type MetricsDay,
} from "@/lib/dashboard/metrics"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

/* Same statuses as the Emails filter, so the two lists cannot drift. */
const EVENT_ITEMS: readonly SelectOption[] = [
  { ...STATUS_ITEMS[0], label: "All events" },
  ...STATUS_ITEMS.slice(1),
]

export function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="font-mono text-caption text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-h2 tabular-nums">{value}</p>
    </div>
  )
}

function SeriesChart({
  rows,
  dataKey,
  label,
  color,
  unit = "",
  minMax,
  risk,
  className,
}: {
  rows: MetricsDay[]
  dataKey: keyof MetricsDay & string
  label: string
  color: string
  unit?: string
  /** Keeps an empty chart from collapsing its Y axis to 0..0. */
  minMax: number
  risk?: number
  className?: string
}) {
  const config = { [dataKey]: { label, color } } satisfies ChartConfig
  const gradientId = `metrics-fill-${dataKey}`

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full", className)}
    >
      <AreaChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={12}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={48}
          allowDecimals={unit !== ""}
          domain={[
            0,
            (dataMax: number) =>
              unit && dataMax > minMax
                ? Math.ceil(dataMax / 10) * 10
                : Math.max(minMax, dataMax),
          ]}
          tickFormatter={(value: number) => `${value}${unit}`}
        />
        <ChartTooltip
          content={<ChartTooltipContent indicator="line" />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {risk !== undefined ? (
          <ReferenceLine
            y={risk}
            stroke="var(--warning)"
            strokeDasharray="3 3"
            label={{
              value: "RISK",
              position: "insideBottomLeft",
              fill: "var(--warning)",
              fontSize: 10,
            }}
          />
        ) : null}
        <Area
          dataKey={dataKey}
          type="linear"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={rows.length === 1}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

type BreakdownEntry = {
  label: string
  count: number
  share: string
}

/** Label, count, and share rows built from the shared Item and Badge. */
function Breakdown({
  tone,
  rows,
}: {
  tone: BadgeTone
  rows: BreakdownEntry[]
}) {
  return (
    <ItemGroup className="gap-0">
      {rows.map((row, index) => (
        <React.Fragment key={row.label}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          <Item size="xs" className="px-0">
            <ItemContent>
              <ItemTitle className="font-normal">{row.label}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground tabular-nums">
                {row.count}
              </span>
              <Badge variant={tone} dot>
                {row.share}
              </Badge>
            </ItemActions>
          </Item>
        </React.Fragment>
      ))}
    </ItemGroup>
  )
}

function RateCard({
  label,
  value,
  help,
  chart,
  children,
}: {
  label: string
  value: string
  help: string
  chart: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Surface>
      <div className="flex items-start justify-between gap-4">
        <Stat label={label} value={value} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`About ${label.toLowerCase()}`}
                className="text-muted-foreground"
              />
            }
          >
            <CircleHelpIcon />
          </TooltipTrigger>
          <TooltipContent side="left">{help}</TooltipContent>
        </Tooltip>
      </div>
      {chart}
      {children}
    </Surface>
  )
}

export function MetricsView() {
  const { state } = useDashboard()
  const [range, setRange] = React.useState<DateRange>(defaultEmailRange)
  const [domain, setDomain] = React.useState("all")
  const [event, setEvent] = React.useState("all")
  const status = isFilterableStatus(event) ? event : null

  const domainItems = React.useMemo<SelectOption[]>(() => {
    const names = new Set(state.emails.map((email) => senderDomain(email.from)))
    return [
      { value: "all", label: "All domains" },
      ...[...names].sort().map((name) => ({ value: name, label: name })),
    ]
  }, [state.emails])

  const { totals, days, domains } = React.useMemo(
    () =>
      summarizeEmails(
        state.emails,
        range,
        domain === "all" ? null : domain,
        status
      ),
    [state.emails, range, domain, status]
  )
  const bounceRate = percent(totals.bounced, totals.sent, 2)
  const complainRate = percent(totals.complained, totals.sent, 2)

  return (
    <>
      <PageHeader title="Metrics">
        <ToolbarFilters
          range={range}
          onRangeChange={(next) => setRange(next ?? defaultEmailRange())}
          allowAllTime={false}
          filters={[
            {
              value: domain,
              onChange: setDomain,
              items: domainItems,
              "aria-label": "Domain",
            },
          ]}
        />
      </PageHeader>

      <Surface>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <Stat label="Emails" value={String(totals.sent)} />
          <Stat
            label="Deliverability rate"
            value={percent(totals.delivered, totals.sent)}
          />
          <div className="ml-auto">
            <ToolbarFilters
              filters={[
                {
                  value: event,
                  onChange: setEvent,
                  items: EVENT_ITEMS,
                  "aria-label": "Event",
                },
              ]}
            />
          </div>
        </div>
        <SeriesChart
          rows={days}
          dataKey="events"
          label={status ? emailStatusLabel(status) : "Emails"}
          color={emailStatusColor(status ?? "delivered")}
          minMax={1}
          className="h-72"
        />
        {domains.length > 0 ? (
          <Breakdown
            tone={EMAIL_STATUS_TONE.delivered}
            rows={domains.map(({ name, counts }) => ({
              label: name,
              count: counts.sent,
              share: percent(counts.delivered, counts.sent),
            }))}
          />
        ) : (
          <p className="text-small text-muted-foreground">
            No emails in this range.
          </p>
        )}
      </Surface>

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <RateCard
          label="Bounce rate"
          value={bounceRate}
          help={`Share of sent emails that bounced. Stay under ${BOUNCE_RISK}% to protect your sender reputation.`}
          chart={
            <SeriesChart
              rows={days}
              dataKey="bounceRate"
              label="Bounce rate (%)"
              color={emailStatusColor("bounced")}
              unit="%"
              minMax={10}
              risk={BOUNCE_RISK}
              className="h-56"
            />
          }
        >
          {/* The event stream only records hard bounces today. */}
          <Breakdown
            tone={EMAIL_STATUS_TONE.bounced}
            rows={[
              { label: "Transient", count: 0, share: "0%" },
              { label: "Permanent", count: totals.bounced, share: bounceRate },
              { label: "Undetermined", count: 0, share: "0%" },
            ]}
          />
        </RateCard>
        <RateCard
          label="Complain rate"
          value={complainRate}
          help={`Share of sent emails marked as spam. Stay under ${COMPLAIN_RISK}% to protect your sender reputation.`}
          chart={
            <SeriesChart
              rows={days}
              dataKey="complainRate"
              label="Complain rate (%)"
              color={emailStatusColor("complained")}
              unit="%"
              minMax={0.2}
              risk={COMPLAIN_RISK}
              className="h-56"
            />
          }
        >
          <Breakdown
            tone={EMAIL_STATUS_TONE.complained}
            rows={[
              {
                label: emailStatusLabel("complained"),
                count: totals.complained,
                share: complainRate,
              },
            ]}
          />
        </RateCard>
      </div>

      <p className="text-small text-muted-foreground">
        Numbers come from the same events as Emails and Logs.
      </p>
    </>
  )
}
