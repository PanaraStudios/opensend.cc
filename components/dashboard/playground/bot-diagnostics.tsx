"use client"
import { useState } from "react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { DetailSection, MetaStrip } from "@/components/dashboard/primitives"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Doc } from "@/convex/_generated/dataModel"
import {
  orderCallTranscript,
  voiceDiagnostic,
} from "@/lib/dashboard/voice-bot-form"
import { VOICE_TOOL_LABELS } from "@/lib/dashboard/voice-options"
import { callOutcomeLabel } from "@/lib/dashboard/voice-playground"
type TranscriptRow = Omit<
  Doc<"callTranscripts">,
  "_id" | "_creationTime" | "organizationId"
> & { id: string; createdAt?: number }
export function Transcript({ lines }: { lines: TranscriptRow[] }) {
  const ordered = orderCallTranscript(lines)
  return (
    <div aria-label="Transcript" className="flex flex-col gap-4">
      {ordered.map((line, i) => {
        const diagnostic = voiceDiagnostic(line)
        if (
          line.kind === "media" &&
          !["Call ended", "Tool call"].includes(diagnostic?.label ?? "")
        )
          return null
        if (line.kind === "tool")
          return (
            <details key={line.id} className="self-start">
              <summary className="cursor-pointer rounded-full border border-border bg-muted px-3 py-1 text-xs">
                {VOICE_TOOL_LABELS[
                  line.toolName as keyof typeof VOICE_TOOL_LABELS
                ] ?? "Tool call"}
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-xs">
                <p className="font-medium">Arguments</p>
                <pre className="break-all whitespace-pre-wrap">
                  {line.arguments}
                </pre>
                <p className="font-medium">Result</p>
                <pre className="break-all whitespace-pre-wrap">
                  {line.result}
                </pre>
              </div>
            </details>
          )
        const latency =
          line.role === "agent"
            ? ordered
                .slice(i + 1)
                .find(
                  (l) =>
                    l.kind === "media" &&
                    voiceDiagnostic(l)?.label === "Turn latency" &&
                    !ordered
                      .slice(i + 1, ordered.indexOf(l))
                      .some(
                        (r) => r.kind === "transcript" && r.role === "agent"
                      )
                )
            : undefined
        return (
          <div
            key={line.id}
            className={`flex max-w-[90%] flex-col gap-1 ${line.role === "caller" ? "items-end self-end" : "items-start self-start"}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {line.kind === "media"
                  ? diagnostic?.label
                  : line.kind === "note"
                    ? "Call note"
                    : line.role === "caller"
                      ? "Caller"
                      : "Bot"}
              </span>
              <time>
                {Math.floor(line.timestampMs / 60000)}:
                {String(Math.floor(line.timestampMs / 1000) % 60).padStart(
                  2,
                  "0"
                )}
              </time>
              {line.text?.endsWith(" [interrupted]") ? (
                <Badge variant="secondary">Interrupted</Badge>
              ) : null}
              {line.final === false ? (
                <Badge variant="secondary">Listening</Badge>
              ) : null}
              {latency ? (
                <Badge variant="secondary">
                  {voiceDiagnostic(latency)?.detail.split(" · ")[0]}
                </Badge>
              ) : null}
            </div>
            <div
              className={`rounded-xl px-4 py-3 text-sm break-words whitespace-pre-wrap ${line.role === "caller" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {diagnostic?.detail ??
                line.text?.replace(/ \[interrupted\]$/, "")}
            </div>
          </div>
        )
      })}
    </div>
  )
}
export function BotDiagnostics({
  call,
}: {
  call: {
    id: string
    bot_id: string | null
    bot_outcome: string | null
    bot_summary: string | null
    bot_usage: {
      inputTokens?: number
      outputTokens?: number
      audioSeconds?: number
      ttsCharacters?: number
    } | null
  }
}) {
  const [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([])
  const lines = useTeamQuery(api.voice.resources.dashboardTranscript, {
    id: call.id,
    limit: 100,
    after,
  }) as { data: TranscriptRow[]; has_more: boolean } | undefined
  const usage = call.bot_usage
  return (
    <div className="flex flex-col gap-5">
      {call.bot_outcome || call.bot_summary || usage ? (
        <>
          <MetaStrip
            items={[
              { label: "Outcome", value: callOutcomeLabel(call.bot_outcome) },
              {
                label: "Tokens",
                value: `${usage?.inputTokens ?? 0} in / ${usage?.outputTokens ?? 0} out`,
              },
              {
                label: "Audio",
                value: `${(usage?.audioSeconds ?? 0).toFixed(1)}s`,
              },
              { label: "Voice characters", value: usage?.ttsCharacters ?? 0 },
            ]}
          />
          {call.bot_summary ? (
            <p className="text-sm">{call.bot_summary}</p>
          ) : null}
        </>
      ) : null}
      <DetailSection title="Transcript">
        {!lines ? (
          <Skeleton className="h-32 w-full" />
        ) : lines.data.length ? (
          <Transcript lines={lines.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            The conversation will appear here.
          </p>
        )}
      </DetailSection>
      {lines?.data.some((l) => l.kind === "tool") ? (
        <DetailSection title="Tool calls">
          {lines.data
            .filter((l) => l.kind === "tool")
            .map((l) => (
              <details key={l.id}>
                <summary className="cursor-pointer text-sm">
                  {VOICE_TOOL_LABELS[
                    l.toolName as keyof typeof VOICE_TOOL_LABELS
                  ] ?? "Tool call"}
                </summary>
                <pre className="mt-2 text-xs break-all whitespace-pre-wrap">
                  Arguments: {l.arguments}
                  {"\n"}Result: {l.result}
                </pre>
              </details>
            ))}
        </DetailSection>
      ) : null}
      {lines && (lines.has_more || history.length) ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!history.length}
            onClick={() => {
              setAfter(history.at(-1))
              setHistory(history.slice(0, -1))
            }}
          >
            Newer activity
          </Button>
          <Button
            variant="outline"
            disabled={!lines.has_more}
            onClick={() => {
              setHistory([...history, after])
              setAfter(lines.data.at(-1)?.id)
            }}
          >
            Older activity
          </Button>
        </div>
      ) : null}
    </div>
  )
}
