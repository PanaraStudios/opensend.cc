"use client"

import { PageHeader, Surface } from "@/components/dashboard/primitives"
import { DEMO_NOW } from "@/lib/dashboard/data"
import { percent } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

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

export function MetricsView() {
  const { state } = useDashboard()
  const sent = state.emails.filter((email) => email.status !== "scheduled")
  const delivered = state.emails.filter((email) =>
    ["delivered", "opened", "clicked"].includes(email.status)
  )
  const opened = state.emails.filter((email) =>
    ["opened", "clicked"].includes(email.status)
  )
  const clicked = state.emails.filter((email) => email.status === "clicked")
  const bounced = state.emails.filter((email) => email.status === "bounced")
  const complained = state.emails.filter((email) => email.status === "complained")

  const byDay = [6, 5, 4, 3, 2, 1, 0].map((daysBack) => {
    const end = DEMO_NOW
    const start = end - (daysBack + 1) * 86_400_000
    const stop = end - daysBack * 86_400_000
    return state.emails.filter(
      (email) => email.createdAt >= start && email.createdAt < stop
    ).length
  })
  const max = Math.max(1, ...byDay)

  return (
    <>
      <PageHeader
        title="Metrics"
        description="Account-level delivery for this workspace. Numbers come from the same events as Emails and Logs."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Sent" value={String(sent.length)} />
        <MetricCard
          label="Delivered"
          value={String(delivered.length)}
          hint={percent(delivered.length, sent.length)}
        />
        <MetricCard
          label="Opened"
          value={String(opened.length)}
          hint={percent(opened.length, delivered.length)}
        />
        <MetricCard
          label="Clicked"
          value={String(clicked.length)}
          hint={percent(clicked.length, delivered.length)}
        />
        <MetricCard
          label="Bounced"
          value={String(bounced.length)}
          hint={percent(bounced.length, sent.length)}
        />
        <MetricCard
          label="Complaints"
          value={String(complained.length)}
          hint={percent(complained.length, sent.length)}
        />
      </div>
      <Surface>
        <p className="font-mono text-caption text-muted-foreground">Last 7 days</p>
        <div className="mt-4 flex h-40 items-end gap-2">
          {byDay.map((count, index) => (
            <div key={index} className="flex flex-1 flex-col items-center gap-2">
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
