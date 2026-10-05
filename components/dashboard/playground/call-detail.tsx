"use client"
import { PhoneIcon } from "lucide-react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  DetailHeader,
  DetailSection,
  MetaStrip,
  EventTrail,
} from "@/components/dashboard/primitives"
import { Skeleton } from "@/components/ui/skeleton"
import { AudioPlayer } from "@/components/ui/audio-player"
import { BotDiagnostics } from "./bot-diagnostics"
import { IvrPath } from "./tester"
import { codeLabel } from "@/lib/dashboard/format"
import {
  callOutcomeLabel,
  ivrActionLabel,
} from "@/lib/dashboard/voice-playground"
export function PlaygroundCallDetail({ id }: { id: string }) {
  const call = useTeamQuery(api.calling.playgroundState.detail, {
    id: id as Id<"calls">,
  })
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  const ivr = useTeamQuery(
    api.ivr.definitions.dashboardGet,
    { id: call?.ivr_id ?? "" },
    { enabled: !!call?.ivr_id }
  )
  const state = useTeamQuery(api.calling.softphoneState.state)
  if (!call) return <Skeleton className="h-60 w-full" />
  return (
    <>
      <DetailHeader
        backHref="/playground/calls"
        backLabel="Calls"
        title={call.test ? "Test call" : "Voice call"}
        icon={PhoneIcon}
      />
      <MetaStrip
        items={[
          { label: "Contact", value: call.contact_name },
          { label: "Phone", value: call.contact_phone ?? "—" },
          {
            label: "To",
            value:
              call.direction === "outbound"
                ? call.contact_name
                : (call.to ?? call.bot_name ?? "Phone menu"),
          },
          {
            label: "Number",
            value:
              setup?.numbers.find((n) => n.id === call.account_id)?.label ??
              "—",
          },
          {
            label: "Started",
            value: new Date(call.observed_at).toLocaleString(),
          },
          {
            label: "Duration",
            value: call.duration === null ? "—" : `${call.duration}s`,
          },
          {
            label: "Outcome",
            value: call.bot_outcome
              ? callOutcomeLabel(call.bot_outcome)
              : call.ivr_outcome
                ? ivrActionLabel(call.ivr_outcome, ivr?.menus)
                : call.outcome
                  ? callOutcomeLabel(call.outcome)
                  : callOutcomeLabel(call.status),
          },
          {
            label: "Transfer target",
            value:
              call.ivr_outcome?.kind === "agents" && call.assigned_agent
                ? (state?.agents.find((a) => a.userId === call.assigned_agent)
                    ?.name ?? "Team member")
                : "—",
          },
        ]}
      />
      {call.error ? (
        <p role="alert" className="text-destructive">
          {call.error}
        </p>
      ) : null}
      <DetailSection title="IVR path">
        {ivr === null ? (
          <p className="text-sm text-muted-foreground">
            This IVR is no longer available. The recorded call path is shown
            below.
          </p>
        ) : null}
        <IvrPath path={call.ivr_path} menus={ivr?.menus} />
      </DetailSection>
      {call.collected ? (
        <DetailSection title="Collected data">
          <dl className="grid gap-3 sm:grid-cols-2">
            {Object.entries(call.collected).map(([key, entry]) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">
                  {codeLabel(key)}
                </dt>
                <dd className="text-sm font-medium">
                  {typeof entry.value === "boolean"
                    ? entry.value
                      ? "Yes"
                      : "No"
                    : String(entry.value)}
                  {entry.inferred ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Inferred from conversation
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          {!Object.keys(call.collected).length ? (
            <p className="text-sm text-muted-foreground">
              No fields were collected.
            </p>
          ) : null}
        </DetailSection>
      ) : null}
      {call.bot_id ? <BotDiagnostics call={call} /> : null}
      {call.recording?.download_url ? (
        <DetailSection title="Recording">
          <AudioPlayer
            src={call.recording.download_url}
            label="Call recording"
          />
        </DetailSection>
      ) : null}
      <DetailSection title="Events">
        <EventTrail
          steps={call.events.map((e, i) => ({
            id: String(i),
            label: e.event
              .replace(/[_.]/g, " ")
              .replace(/^./, (c) => c.toUpperCase()),
            icon: PhoneIcon,
            caption: new Date(e.at).toLocaleString(),
          }))}
        />
      </DetailSection>
    </>
  )
}
