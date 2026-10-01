"use client"
import { useState } from "react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  DetailSection,
  MetaStrip,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Doc } from "@/convex/_generated/dataModel"
import { voiceDiagnostic } from "@/lib/dashboard/voice-bot-form"
type TranscriptRow = Omit<
  Doc<"callTranscripts">,
  "_id" | "_creationTime" | "organizationId"
> & { id: string }
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
    <DetailSection title="Voice bot activity">
      <MetaStrip
        items={[
          { label: "Outcome", value: call.bot_outcome ?? "Listening…" },
          {
            label: "Tokens (in / out)",
            value: `${usage?.inputTokens ?? 0} / ${usage?.outputTokens ?? 0}`,
          },
          {
            label: "Audio usage",
            value: `${(usage?.audioSeconds ?? 0).toFixed(1)}s`,
          },
          { label: "TTS characters", value: usage?.ttsCharacters ?? 0 },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Usage is reported by the provider. Charges are billed to your provider
        key; dollar totals are not reported by this engine. Latency measures end
        of caller speech to first bot audio.
      </p>
      {call.bot_summary ? <p className="text-sm">{call.bot_summary}</p> : null}
      {!lines ? (
        <Skeleton className="h-32 w-full" />
      ) : !lines.data.length ? (
        <p className="text-sm text-muted-foreground">
          Transcript, tools and timing will appear as the call runs.
        </p>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Position</Th>
              <Th>Activity</Th>
              <Th>Details</Th>
            </>
          }
        >
          {lines.data
            .slice()
            .sort((a, b) => a.timestampMs - b.timestampMs)
            .map((line) => {
              const diagnostic = voiceDiagnostic(line)
              return (
                <TableRow key={line.id}>
                  <TableCell>{(line.timestampMs / 1000).toFixed(1)}s</TableCell>
                  <TableCell>
                    {line.kind === "transcript"
                      ? line.role === "caller"
                        ? "Caller"
                        : "Bot"
                      : line.kind === "tool"
                        ? line.toolName
                        : (diagnostic?.label ?? line.kind)}
                    {line.text?.endsWith(" [interrupted]") ? (
                      <Badge variant="secondary">Interrupted</Badge>
                    ) : null}
                    {line.final === false ? (
                      <Badge variant="secondary">Partial</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-xl whitespace-normal">
                    {line.kind === "tool" ? (
                      <div className="flex flex-col gap-2">
                        <code className="text-xs break-all">
                          Arguments: {line.arguments}
                        </code>
                        <code className="text-xs break-all">
                          Result: {line.result}
                        </code>
                      </div>
                    ) : diagnostic ? (
                      diagnostic.detail
                    ) : (
                      line.text
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
        </ResourceTable>
      )}
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
    </DetailSection>
  )
}
