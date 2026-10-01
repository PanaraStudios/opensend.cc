"use client"
import * as React from "react"
import { useAction } from "convex/react"
import { PhoneIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import {
  DetailSection,
  Surface,
  OptionSelect,
  ResourceTable,
  EmptyState,
  RelativeTime,
} from "@/components/dashboard/primitives"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { TableHead, TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import { FileUploadField } from "@/components/dashboard/file-upload"
import { writableCallingSettings } from "@/lib/meta/calling"
import type {
  CallingSettings,
  WhatsAppCall,
} from "@/packages/sdk/src/whatsapp/calling/interfaces"
const statusOptions = [
  { value: "ENABLED", label: "Enabled" },
  { value: "DISABLED", label: "Disabled" },
]
const days = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const

export function CallingPanel({
  accountId,
  canWrite,
}: {
  accountId: Id<"channelAccounts">
  canWrite: boolean
}) {
  const cached = useTeamQuery(api.calling.settingsState.cached, {
    accountId,
  }) as
    | {
        handling_mode: "api" | "gateway"
        calling: CallingSettings
        restrictions: unknown
      }
    | undefined
  const { activeTeamId } = useWorkspace()
  const update = useAction(api.calling.settings.dashboardUpdate)
  const [busy, setBusy] = React.useState(false)
  const [edit, setEdit] = React.useState<CallingSettings | null>(null)
  const [mode, setMode] = React.useState<"api" | "gateway" | null>(null)
  const [announcement, setAnnouncement] = React.useState<Id<"storedFiles">>()
  const calling =
    edit ?? (writableCallingSettings({ ...cached?.calling }) as CallingSettings)
  const currentMode = mode ?? cached?.handling_mode ?? "api"
  const change = (patch: Partial<CallingSettings>) =>
    setEdit({ ...calling, ...patch })
  const hours = calling.call_hours
  const [after, setAfter] = React.useState<string>()
  const [history, setHistory] = React.useState<(string | undefined)[]>([])
  const log = useTeamQuery(api.calling.rows.dashboardList, {
    accountId,
    limit: 20,
    after,
  }) as { has_more: boolean; data: WhatsAppCall[] } | undefined
  const save = async (refresh = false) => {
    if (!activeTeamId) return
    setBusy(true)
    try {
      await update({
        organizationId: activeTeamId,
        from: accountId,
        ...(refresh
          ? {}
          : {
              mode: currentMode,
              calling: { ...edit },
              announcementFileId: announcement,
            }),
      })
      setEdit(null)
      setMode(null)
      setAnnouncement(undefined)
      toast.add({
        type: "success",
        title: refresh
          ? "Calling settings refreshed"
          : "Calling settings saved",
      })
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    } finally {
      setBusy(false)
    }
  }
  const disabled = !canWrite || busy
  return (
    <>
      <DetailSection
        title="Calling"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Refresh settings
          </Button>
        }
      >
        {cached === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Surface>
            <FieldGroup>
              <Field>
                <FieldLabel>Calling status</FieldLabel>
                <OptionSelect
                  aria-label="Calling status"
                  items={statusOptions}
                  value={calling.status ?? "DISABLED"}
                  disabled={disabled}
                  onChange={(value) =>
                    change({ status: value as "ENABLED" | "DISABLED" })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Call handling</FieldLabel>
                <OptionSelect
                  aria-label="Call handling"
                  items={[
                    { value: "gateway", label: "Media gateway" },
                    { value: "api", label: "Your calling integration" },
                  ]}
                  value={currentMode}
                  disabled={disabled}
                  onChange={(value) => setMode(value as "api" | "gateway")}
                />
                <FieldDescription>
                  Choose who handles the audio. Your integration receives the
                  caller’s SDP through customer webhooks.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Call icon</FieldLabel>
                <OptionSelect
                  aria-label="Call icon"
                  items={[
                    { value: "DEFAULT", label: "Visible" },
                    { value: "DISABLE_ALL", label: "Hidden" },
                  ]}
                  value={calling.call_icon_visibility ?? "DEFAULT"}
                  disabled={disabled}
                  onChange={(value) =>
                    change({
                      call_icon_visibility: value as "DEFAULT" | "DISABLE_ALL",
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="call-countries">
                  Allowed user countries
                </FieldLabel>
                <Input
                  id="call-countries"
                  placeholder="US, BR (empty allows all)"
                  disabled={disabled}
                  value={
                    calling.call_icons?.restrict_to_user_countries.join(", ") ??
                    ""
                  }
                  onChange={(e) =>
                    change({
                      call_icons: {
                        restrict_to_user_countries: e.target.value
                          .split(",")
                          .map((v) => v.trim().toUpperCase())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="callback-permission"
                  disabled={disabled}
                  checked={calling.callback_permission_status === "ENABLED"}
                  onCheckedChange={(checked) =>
                    change({
                      callback_permission_status: checked
                        ? "ENABLED"
                        : "DISABLED",
                    })
                  }
                />
                <FieldLabel htmlFor="callback-permission">
                  Allow callback permission after an incoming call
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="additional-codecs"
                  disabled={disabled}
                  checked={!!calling.audio?.additional_codecs.length}
                  onCheckedChange={(checked) =>
                    change({
                      audio: {
                        additional_codecs: checked ? ["PCMA", "PCMU"] : [],
                      },
                    })
                  }
                />
                <FieldLabel htmlFor="additional-codecs">
                  Allow G.711 codecs for your integration
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel>Call hours</FieldLabel>
                <OptionSelect
                  aria-label="Call hours"
                  items={statusOptions}
                  disabled={disabled}
                  value={hours?.status ?? "DISABLED"}
                  onChange={(value) =>
                    change({
                      call_hours: {
                        ...hours,
                        status: value as "ENABLED" | "DISABLED",
                        timezone_id: hours?.timezone_id ?? "UTC",
                        weekly_operating_hours:
                          hours?.weekly_operating_hours ?? [],
                      },
                    })
                  }
                />
              </Field>
              {hours?.status === "ENABLED" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="call-timezone">Time zone</FieldLabel>
                    <Input
                      id="call-timezone"
                      disabled={disabled}
                      value={hours.timezone_id ?? "UTC"}
                      onChange={(e) =>
                        change({
                          call_hours: { ...hours, timezone_id: e.target.value },
                        })
                      }
                    />
                  </Field>
                  {days.map((day) => (
                    <Field key={day}>
                      <FieldLabel>
                        {day[0] + day.slice(1).toLowerCase()}
                      </FieldLabel>
                      {[0, 1].map((slot) => {
                        const entries =
                            hours.weekly_operating_hours?.filter(
                              (h) => h.day_of_week === day
                            ) ?? [],
                          entry = entries[slot]
                        const setTime = (
                          key: "open_time" | "close_time",
                          time: string
                        ) => {
                          const otherDays =
                            hours.weekly_operating_hours?.filter(
                              (h) => h.day_of_week !== day
                            ) ?? []
                          const newEntries = [...entries]
                          newEntries[slot] = {
                            day_of_week: day,
                            open_time: entry?.open_time ?? "0900",
                            close_time: entry?.close_time ?? "1700",
                            [key]: time.replace(":", ""),
                          }
                          change({
                            call_hours: {
                              ...hours,
                              weekly_operating_hours: [
                                ...otherDays,
                                ...newEntries.filter(
                                  (h) => h?.open_time && h?.close_time
                                ),
                              ],
                            },
                          })
                        }
                        return (
                          <div key={slot} className="flex items-center gap-2">
                            <Input
                              aria-label={`${day} opening ${slot + 1}`}
                              type="time"
                              disabled={disabled}
                              value={
                                entry
                                  ? `${entry.open_time.slice(0, 2)}:${entry.open_time.slice(2)}`
                                  : ""
                              }
                              onChange={(e) =>
                                setTime("open_time", e.target.value)
                              }
                            />
                            <Input
                              aria-label={`${day} closing ${slot + 1}`}
                              type="time"
                              disabled={disabled}
                              value={
                                entry
                                  ? `${entry.close_time.slice(0, 2)}:${entry.close_time.slice(2)}`
                                  : ""
                              }
                              onChange={(e) =>
                                setTime("close_time", e.target.value)
                              }
                            />
                            {entry ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={disabled}
                                onClick={() =>
                                  change({
                                    call_hours: {
                                      ...hours,
                                      weekly_operating_hours: (
                                        hours.weekly_operating_hours ?? []
                                      ).filter((h) => h !== entry),
                                    },
                                  })
                                }
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        )
                      })}
                    </Field>
                  ))}
                  <FieldDescription>
                    Saving replaces the entire weekly and holiday schedule.
                  </FieldDescription>
                  {(hours.holiday_schedule ?? []).map((holiday, index) => (
                    <Field key={index}>
                      <FieldLabel>Holiday {index + 1}</FieldLabel>
                      <div className="flex items-center gap-2">
                        {(["date", "start_time", "end_time"] as const).map(
                          (key) => (
                            <Input
                              key={key}
                              aria-label={`Holiday ${index + 1} ${key}`}
                              type={key === "date" ? "date" : "time"}
                              disabled={disabled}
                              value={
                                key === "date"
                                  ? holiday[key]
                                  : `${holiday[key].slice(0, 2)}:${holiday[key].slice(2)}`
                              }
                              onChange={(e) =>
                                change({
                                  call_hours: {
                                    ...hours,
                                    holiday_schedule:
                                      hours.holiday_schedule!.map((h, i) =>
                                        i === index
                                          ? {
                                              ...h,
                                              [key]:
                                                key === "date"
                                                  ? e.target.value
                                                  : e.target.value.replace(
                                                      ":",
                                                      ""
                                                    ),
                                            }
                                          : h
                                      ),
                                  },
                                })
                              }
                            />
                          )
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() =>
                            change({
                              call_hours: {
                                ...hours,
                                holiday_schedule:
                                  hours.holiday_schedule!.filter(
                                    (_, i) => i !== index
                                  ),
                              },
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </Field>
                  ))}
                  <Button
                    variant="outline"
                    disabled={
                      disabled || (hours.holiday_schedule?.length ?? 0) >= 20
                    }
                    onClick={() =>
                      change({
                        call_hours: {
                          ...hours,
                          holiday_schedule: [
                            ...(hours.holiday_schedule ?? []),
                            {
                              date: new Date().toISOString().slice(0, 10),
                              start_time: "0000",
                              end_time: "2359",
                            },
                          ],
                        },
                      })
                    }
                  >
                    Add holiday
                  </Button>
                </>
              ) : null}
              <Field>
                <FieldLabel>Voicemail</FieldLabel>
                <OptionSelect
                  aria-label="Voicemail"
                  items={statusOptions}
                  disabled={disabled}
                  value={calling.voicemail?.status ?? "DISABLED"}
                  onChange={(value) =>
                    change({
                      voicemail: {
                        ...calling.voicemail,
                        status: value as "ENABLED" | "DISABLED",
                        triggers: calling.voicemail?.triggers ?? [
                          "REJECT",
                          "TIMEOUT",
                        ],
                        audio: calling.voicemail?.audio ?? {
                          default: { timeout_seconds: 20 },
                        },
                      },
                    })
                  }
                />
              </Field>
              {calling.voicemail?.status === "ENABLED" ? (
                <>
                  <FileUploadField
                    label="Voicemail announcement (Ogg Opus, under 60 seconds)"
                    use="template"
                    disabled={disabled}
                    onUploaded={(id) => setAnnouncement(id)}
                  />
                  <Field>
                    <FieldLabel htmlFor="voicemail-timeout">
                      Voicemail timeout (seconds)
                    </FieldLabel>
                    <Input
                      id="voicemail-timeout"
                      type="number"
                      min={0}
                      max={30}
                      disabled={disabled}
                      value={
                        calling.voicemail.audio?.default.timeout_seconds ?? 20
                      }
                      onChange={(e) =>
                        change({
                          voicemail: {
                            ...calling.voicemail!,
                            audio: {
                              default: {
                                ...calling.voicemail?.audio?.default,
                                timeout_seconds: Number(e.target.value),
                              },
                            },
                          },
                        })
                      }
                    />
                  </Field>
                </>
              ) : null}
              <Button
                disabled={disabled || (!edit && !mode && !announcement)}
                onClick={() => void save()}
              >
                Save calling settings
              </Button>
            </FieldGroup>
          </Surface>
        )}
      </DetailSection>
      <DetailSection title="Call log">
        {log === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : !log.data.length ? (
          <EmptyState
            size="sm"
            icon={PhoneIcon}
            title="No calls yet"
            description="Incoming and outgoing WhatsApp calls appear here."
          />
        ) : (
          <>
            <ResourceTable
              headers={
                <>
                  {[
                    "Contact",
                    "Direction",
                    "Status",
                    "Duration",
                    "When",
                    "Files",
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </>
              }
            >
              {log.data.map((call) => (
                <TableRow key={call.id}>
                  <TableCell>
                    {call.user_id ?? call.from ?? call.to ?? "Unknown"}
                  </TableCell>
                  <TableCell>{call.direction}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{call.status}</Badge>
                    {call.error ? (
                      <p className="text-muted-foreground">{call.error}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {call.duration === null ? "—" : `${call.duration}s`}
                  </TableCell>
                  <TableCell>
                    <RelativeTime at={Date.parse(call.created_at)} />
                  </TableCell>
                  <TableCell>
                    {call.recording?.download_url ? (
                      <a href={call.recording.download_url}>Recording</a>
                    ) : null}
                    {call.transcription?.download_url ? (
                      <a
                        className="ml-2"
                        href={call.transcription.download_url}
                      >
                        Transcript
                      </a>
                    ) : null}
                    {call.recording?.error || call.transcription?.error ? (
                      <p>
                        {call.recording?.error ?? call.transcription?.error}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </ResourceTable>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!history.length}
                onClick={() => {
                  setAfter(history.at(-1))
                  setHistory(history.slice(0, -1))
                }}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!log.has_more}
                onClick={() => {
                  setHistory([...history, after])
                  setAfter(log.data.at(-1)?.id)
                }}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </DetailSection>
    </>
  )
}
