"use client"

import * as React from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"
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
  ChartLegend,
  ChartLegendContent,
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
  ResourceTable,
  Th,
  emailStatusColor,
  channelMessageStatusColor,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { defaultEmailRange } from "@/lib/dashboard/email-range"
import {
  EMAIL_STATUS_TONE,
  emailStatusLabel,
  percent,
  sentenceCase,
  type BadgeTone,
} from "@/lib/dashboard/format"
import { BOUNCE_RISK, COMPLAIN_RISK } from "@/lib/dashboard/metrics"
import {
  useMetrics,
  useMetricsChunks,
  useMetricsSpans,
} from "@/lib/metrics/use-metrics"
import { format } from "date-fns"
import {
  CHANNEL_IDS,
  CHANNEL_MESSAGE_STATUSES,
  CHANNELS,
  type Channel,
  type MessagingChannel,
} from "@/lib/channels"
import { channelRates, sumChannelCounts } from "@/lib/channel-metrics"
import { ChannelCell } from "@/components/dashboard/channels/shared"
import { TableCell, TableRow } from "@/components/ui/table"
import { useClock } from "@/lib/time/use-clock"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/* Same statuses as the Emails filter, so the two lists cannot drift. */
const EVENT_ITEMS: readonly SelectOption[] = [
  { ...STATUS_ITEMS[0], label: "All events" },
  ...STATUS_ITEMS.slice(1),
]

const METRIC_CHANNEL_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All channels" },
  ...CHANNEL_IDS.map((value) => ({ value, label: CHANNELS[value].label })),
]

export function Stat({
  label,
  value,
  className,
  testId,
}: {
  testId?: string
  label: string
  value: string
  className?: string
}) {
  return (
    <div data-testid={testId} className={cn("min-w-0", className)}>
      <p className="font-mono text-caption text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-h2 tabular-nums">{value}</p>
    </div>
  )
}

function SeriesChart({
  rows,
  dataKey = "",
  label = "",
  color = "var(--chart-1)",
  series,
  stacked = false,
  unit = "",
  minMax,
  risk,
  className,
}: {
  rows: { label: string }[]
  dataKey?: string
  label?: string
  color?: string
  series?: { dataKey: string; label: string; color: string }[]
  stacked?: boolean
  unit?: string
  /** Keeps an empty chart from collapsing its Y axis to 0..0. */
  minMax: number
  risk?: number
  className?: string
}) {
  const entries = series ?? [{ dataKey, label, color }]
  const config = Object.fromEntries(
    entries.map((entry) => [
      entry.dataKey,
      { label: entry.label, color: entry.color },
    ])
  ) satisfies ChartConfig
  const chartId = React.useId().replace(/:/g, "")
  const gradientId = (key: string) => `metrics-fill-${chartId}-${key}`

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full", className)}
    >
      <AreaChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 8 }}>
        <defs>
          {entries.map((entry) => (
            <linearGradient
              key={entry.dataKey}
              id={gradientId(entry.dataKey)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={entry.color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={entry.color} stopOpacity={0} />
            </linearGradient>
          ))}
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
        {series ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {entries.map((entry) => (
          <Area
            key={entry.dataKey}
            dataKey={entry.dataKey}
            type="linear"
            stroke={entry.color}
            strokeWidth={1.5}
            fill={`url(#${gradientId(entry.dataKey)})`}
            stackId={stacked ? "messages" : undefined}
            dot={rows.length === 1}
            isAnimationActive={false}
          />
        ))}
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
  const now = useClock()
  const [chosenRange, setRange] = React.useState<DateRange>()
  const range = React.useMemo(
    () => chosenRange ?? defaultEmailRange(now ?? 0),
    [chosenRange, now]
  )
  const [channel, setChannel] = React.useState("all")
  const [domain, setDomain] = React.useState("all")
  const [domainSearch, setDomainSearch] = React.useState("")
  const { activeTeamId } = useWorkspace()
  const options = useQuery(
    api.metrics.domainOptions,
    activeTeamId && channel === "email"
      ? {
          organizationId: activeTeamId,
          search: domainSearch,
          selectedId: domain === "all" ? undefined : (domain as Id<"domains">),
        }
      : "skip"
  )
  if (now === null) return <Skeleton className="h-64 w-full" />
  return (
    <>
      <PageHeader title="Metrics">
        <ToolbarFilters
          range={range}
          onRangeChange={(next) => setRange(next ?? defaultEmailRange(now))}
          now={now}
          allowAllTime={false}
          filters={[
            {
              value: channel,
              onChange: setChannel,
              items: METRIC_CHANNEL_ITEMS,
              "aria-label": "Channel",
            },
            ...(channel === "email"
              ? [
                  {
                    search: { onChange: setDomainSearch },
                    value: domain,
                    onChange: setDomain,
                    items: [
                      { value: "all", label: "All domains" },
                      ...(options ?? []),
                    ],
                    "aria-label": "Domain",
                  },
                ]
              : []),
          ]}
        />
      </PageHeader>
      {channel === "email" ? (
        <EmailMetrics range={range} domain={domain} />
      ) : (
        <ChannelMetrics
          range={range}
          channel={
            channel === "all" ? undefined : (channel as MessagingChannel)
          }
          onChannelChange={setChannel}
        />
      )}
    </>
  )
}

/** The Meta channels share the same tiles; receipt support lives in the registry. */
function ChannelMetrics({
  range,
  channel,
  onChannelChange,
}: {
  range: DateRange
  channel?: MessagingChannel
  onChannelChange: (channel: Channel) => void
}) {
  const { activeTeamId } = useWorkspace()
  const spans = useMetricsSpans(range)
  const args = React.useMemo(
    () =>
      activeTeamId ? { organizationId: activeTeamId, channel, spans } : null,
    [activeTeamId, channel, spans]
  )
  const counts = useMetricsChunks(api.metrics.channelSummary, args, spans)
  if (!counts) return <Skeleton className="h-64 w-full" />
  const days = counts.map((rows, i) => ({
    label: format(spans[i].from, "MMM d"),
    ...Object.fromEntries(
      rows.map((row) => [row.channel, row.counts.sent + row.counts.received])
    ),
    ...(channel ? rows[0].status : {}),
    ...channelRates(sumChannelCounts(rows.map((row) => row.counts))),
  }))
  const totalsFor = (value: Channel) =>
    sumChannelCounts(
      counts.flatMap((rows) =>
        rows.filter((row) => row.channel === value).map((row) => row.counts)
      )
    )
  const allTotals = sumChannelCounts(
    counts.flatMap((rows) => rows.map((row) => row.counts))
  )
  if (!channel)
    return (
      <>
        <ResourceTable
          headers={
            <>
              <Th>Channel</Th>
              <Th>Sent</Th>
              <Th>Received</Th>
              <Th>Delivery rate</Th>
              <Th>Failed</Th>
            </>
          }
        >
          {CHANNEL_IDS.map((value) => {
            const totals = totalsFor(value)
            return (
              <TableRow
                key={value}
                data-testid={`metrics-channel-${value}`}
                onClick={() => onChannelChange(value)}
              >
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChannelChange(value)}
                    aria-label={`View ${CHANNELS[value].label} metrics`}
                  >
                    <ChannelCell channel={value} />
                  </Button>
                </TableCell>
                <TableCell>{totals.sent}</TableCell>
                <TableCell>{totals.received}</TableCell>
                <TableCell>
                  {CHANNELS[value].supports.delivered
                    ? `${channelRates(totals).deliveryRate}%`
                    : "—"}
                </TableCell>
                <TableCell>{totals.failed}</TableCell>
              </TableRow>
            )
          })}
        </ResourceTable>
        <Surface>
          <Stat
            label="Messages per day"
            value={String(allTotals.sent + allTotals.received)}
          />
          <SeriesChart
            rows={days}
            minMax={1}
            className="h-72"
            stacked
            series={CHANNEL_IDS.map((value, i) => ({
              dataKey: value,
              label: CHANNELS[value].label,
              color: `var(--chart-${i + 1})`,
            }))}
          />
        </Surface>
      </>
    )
  const totals = totalsFor(channel)
  const rates = channelRates(totals)
  const delivered = CHANNELS[channel].supports.delivered
  const statuses = CHANNEL_MESSAGE_STATUSES.filter(
    (status) => delivered || status !== "delivered"
  )
  return (
    <>
      <Surface>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          {(["sent", "delivered", "read", "failed", "received"] as const)
            .filter((key) => delivered || key !== "delivered")
            .map((key) => (
              <Stat
                key={key}
                label={sentenceCase(key)}
                value={String(totals[key])}
                testId={`metrics-stat-${key}`}
              />
            ))}
        </div>
        <SeriesChart
          rows={days}
          minMax={1}
          className="h-72"
          stacked
          series={statuses.map((status) => ({
            dataKey: status,
            label: sentenceCase(status),
            color: channelMessageStatusColor(status),
          }))}
        />
      </Surface>
      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        {delivered ? (
          <RateCard
            label="Delivery rate"
            value={`${rates.deliveryRate}%`}
            help="Delivered or read messages as a share of all outbound attempts, including queued and failed messages."
            chart={
              <SeriesChart
                rows={days}
                dataKey="deliveryRate"
                label="Delivery rate (%)"
                color="var(--chart-2)"
                unit="%"
                minMax={100}
                className="h-56"
              />
            }
          >
            <Breakdown
              tone="success"
              rows={[
                {
                  label: "Delivered",
                  count: totals.delivered,
                  share: `${rates.deliveryRate}%`,
                },
              ]}
            />
          </RateCard>
        ) : null}
        <RateCard
          label="Read rate"
          value={`${rates.readRate}%`}
          help="Read messages as a share of all outbound attempts, including queued and failed messages."
          chart={
            <SeriesChart
              rows={days}
              dataKey="readRate"
              label="Read rate (%)"
              color="var(--chart-3)"
              unit="%"
              minMax={100}
              className="h-56"
            />
          }
        >
          <Breakdown
            tone="success"
            rows={[
              {
                label: "Read",
                count: totals.read,
                share: `${rates.readRate}%`,
              },
            ]}
          />
        </RateCard>
      </div>
      <p className="text-small text-muted-foreground">
        Sent includes queued and failed outbound attempts. Daily statuses
        reflect each message&apos;s current status.
        {!delivered ? " Instagram does not provide delivered receipts." : ""}
      </p>
    </>
  )
}

function EmailMetrics({ range, domain }: { range: DateRange; domain: string }) {
  const [event, setEvent] = React.useState("all")
  const status = isFilterableStatus(event) ? event : null
  const { loading, totals, days, domains } = useMetrics(range, domain, status)
  if (loading) return <Skeleton className="h-64 w-full" />
  const bounceRate = percent(totals.bounced, totals.sent, 2)
  const complainRate = percent(totals.complained, totals.sent, 2)

  return (
    <>
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
          <Breakdown
            tone={EMAIL_STATUS_TONE.bounced}
            rows={[
              {
                label: "Transient",
                count: totals.Transient,
                share: percent(totals.Transient, totals.sent, 2),
              },
              {
                label: "Permanent",
                count: totals.Permanent,
                share: percent(totals.Permanent, totals.sent, 2),
              },
              {
                label: "Undetermined",
                count: totals.Undetermined,
                share: percent(totals.Undetermined, totals.sent, 2),
              },
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
