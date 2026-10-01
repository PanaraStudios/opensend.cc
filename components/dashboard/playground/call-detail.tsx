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
import { ivrActionLabel } from "@/lib/dashboard/voice-playground"
export function PlaygroundCallDetail({ id }: { id: string }) {
  const call = useTeamQuery(api.calling.playgroundState.detail, {
    id: id as Id<"calls">,
  })
  const state = useTeamQuery(api.calling.softphoneState.state)
  if (!call) return <Skeleton className="h-60 w-full" />
  return (
    <>
      <DetailHeader
        backHref="/playground/calls"
        backLabel="Calls"
        title={call.test ? "Test call" : "Voice call"}
        description={call.id}
      />
      <MetaStrip
        items={[
          { label: "Status", value: call.status },
          { label: "Direction", value: call.direction },
          {
            label: "Duration",
            value: call.duration === null ? "—" : `${call.duration}s`,
          },
          {
            label: "Outcome",
            value: call.bot_outcome ?? ivrActionLabel(call.ivr_outcome),
          },
          {
            label: "Transfer target",
            value:
              call.ivr_outcome?.kind === "agents" && call.assigned_agent
                ? (state?.agents.find((a) => a.userId === call.assigned_agent)
                    ?.name ?? call.assigned_agent)
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
        <IvrPath path={call.ivr_path} />
      </DetailSection>
      {call.bot_id ? <BotDiagnostics call={call} /> : null}
      {call.recording?.download_url ? (
        <AudioPlayer src={call.recording.download_url} label="Call recording" />
      ) : null}
      <DetailSection title="Events">
        <EventTrail
          steps={call.events.map((e, i) => ({
            id: String(i),
            label: e.event,
            icon: PhoneIcon,
            caption: new Date(e.at).toLocaleString(),
          }))}
        />
      </DetailSection>
    </>
  )
}
