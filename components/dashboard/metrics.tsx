"use client"

import { PageHeader, Surface } from "@/components/dashboard/primitives"
import { DAY, DEMO_NOW } from "@/lib/dashboard/data"
import { percent } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { EmailStatus, SentEmail } from "@/lib/dashboard/types"

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Surface className="[&_.panel]:p-5">
      <p className="font-mono text-caption text-muted-foreground">{label}</p>
      <p className="mt-1 text-h3">{value}</p>
      {hint ? (
        <p className="mt-1 text-small text-muted-foreground">{hint}</p>
      ) : null}
    </Surface>
  )
}

type Counter =
  "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained"

/* A status implies every earlier step: a click was also an open and a delivery. */
const REACHED: Partial<Record<EmailStatus, Counter[]>> = {
  delivered: ["delivered"],
  opened: ["delivered", "opened"],
  clicked: ["delivered", "opened", "clicked"],
  bounced: ["bounced"],
  complained: ["complained"],
}

/** One pass over emails: status counts plus a 7-day histogram ending today. */
function summarize(emails: SentEmail[]) {
  const counts: Record<Counter, number> = {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
  }
  const byDay = [0, 0, 0, 0, 0, 0, 0]
  for (const email of emails) {
    if (email.status !== "scheduled") counts.sent += 1
    for (const counter of REACHED[email.status] ?? []) counts[counter] += 1
    const daysBack = Math.floor((DEMO_NOW - email.createdAt) / DAY)
    if (daysBack >= 0 && daysBack < 7) byDay[6 - daysBack] += 1
  }
  return { counts, byDay }
}

export function MetricsView() {
  const { state } = useDashboard()
  const { counts, byDay } = summarize(state.emails)
  const max = Math.max(1, ...byDay)

  return (
    <>
      <PageHeader
        title="Metrics"
        description="Account-level delivery for this workspace. Numbers come from the same events as Emails and Logs."
      />
      <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Sent" value={String(counts.sent)} />
        <MetricCard
          label="Delivered"
          value={String(counts.delivered)}
          hint={percent(counts.delivered, counts.sent)}
        />
        <MetricCard
          label="Opened"
          value={String(counts.opened)}
          hint={percent(counts.opened, counts.delivered)}
        />
        <MetricCard
          label="Clicked"
          value={String(counts.clicked)}
          hint={percent(counts.clicked, counts.delivered)}
        />
        <MetricCard
          label="Bounced"
          value={String(counts.bounced)}
          hint={percent(counts.bounced, counts.sent)}
        />
        <MetricCard
          label="Complaints"
          value={String(counts.complained)}
          hint={percent(counts.complained, counts.sent)}
        />
      </div>
      <Surface>
        <p className="font-mono text-caption text-muted-foreground">
          Last 7 days
        </p>
        <div className="mt-4 flex h-40 items-end gap-2">
          {byDay.map((count, index) => (
            <div
              key={index}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <div
                className="w-full rounded-t-md bg-(image:--gradient-primary)"
                style={{ height: `${Math.max(8, (count / max) * 100)}%` }}
              />
              <span className="font-mono text-caption text-muted-foreground">
                {count}
              </span>
            </div>
          ))}
        </div>
      </Surface>
    </>
  )
}
