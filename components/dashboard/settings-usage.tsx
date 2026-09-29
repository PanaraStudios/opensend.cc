"use client"

import Link from "next/link"
import { useQuery } from "convex/react"
import { InfoIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"
import { SettingsCard } from "@/components/dashboard/primitives"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useClock } from "@/lib/time/use-clock"
import { SES_SETTINGS_PAGE } from "@/lib/dashboard/nav"

const number = (value: number) => value.toLocaleString("en-US")
const resetTime = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }) + " UTC"

function UsageCard({
  title,
  used,
  limit,
  description,
  reset,
  unknown = false,
}: {
  title: string
  used: number
  limit: number | null
  description: string
  reset?: string
  unknown?: boolean
}) {
  const label = `${number(used)} / ${limit === null ? (unknown ? "Unavailable" : "Unlimited") : number(limit)}`
  return (
    <section aria-label={title}>
      <SettingsCard title={title} description={description}>
        <p
          className="text-base font-medium tabular-nums"
          data-testid="usage-value"
        >
          {label}
        </p>
        {limit !== null ? (
          <Progress
            aria-label={title}
            aria-valuetext={label}
            value={
              limit > 0
                ? Math.min(100, (used / limit) * 100)
                : used > 0
                  ? 100
                  : 0
            }
          />
        ) : null}
        {reset ? (
          <p className="text-small text-muted-foreground">
            Resets {resetTime(reset)}
          </p>
        ) : null}
      </SettingsCard>
    </section>
  )
}

export function SettingsUsage() {
  const { activeTeamId } = useWorkspace()
  const now = useClock()
  const data = useQuery(
    api.usage.get,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          day: now === null ? undefined : Math.floor(now / 86_400_000),
        }
      : "skip"
  )
  const installation = useQuery(api.installation.status, {})
  if (data === undefined) return <Skeleton className="h-64 w-full" />
  const { usage, quota } = data
  const { daily, monthly } = usage.emails
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-small text-muted-foreground">
        Your team’s usage. Email totals use UTC calendar days and months. This
        self-hosted installation has no billing plan.
      </p>
      <Alert>
        <InfoIcon />
        <AlertTitle>Shared Amazon SES quota</AlertTitle>
        <AlertDescription>
          <p>
            The daily limit{quota.region ? ` in ${quota.region}` : ""} is shared
            by every team on this installation. Amazon SES enforces a rolling
            24-hour sending quota. These totals include sent and received emails
            and reset at midnight UTC; they do not show remaining SES capacity.
          </p>
          {quota.reason ? <p>{quota.reason}</p> : null}
          {quota.checkedAt ? (
            <p>
              Quota last checked{" "}
              {resetTime(new Date(quota.checkedAt).toISOString())}.
            </p>
          ) : null}
          {installation?.admin ? (
            <Button
              variant="link"
              nativeButton={false}
              render={<Link href={SES_SETTINGS_PAGE.href} />}
            >
              Amazon SES settings
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
      <UsageCard
        title="Emails today"
        {...daily}
        reset={daily.resets_at}
        unknown
        description={`${number(daily.sent)} sent · ${number(daily.received)} received`}
      />
      <UsageCard
        title="Emails this month"
        {...monthly}
        reset={monthly.resets_at}
        description={`${number(monthly.sent)} sent · ${number(monthly.received)} received`}
      />
      <UsageCard
        title="Contacts"
        {...usage.contacts}
        description="Contacts stored by your team."
      />
      <UsageCard
        title="Segments"
        {...usage.segments}
        description="Segments created by your team."
      />
      <UsageCard
        title="Broadcasts sent"
        {...usage.broadcasts}
        description="Broadcasts your team has sent."
      />
    </div>
  )
}
