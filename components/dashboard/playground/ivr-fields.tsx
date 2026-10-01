"use client"
import { createContext, useContext, useId } from "react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import { AudioPlayer } from "@/components/ui/audio-player"
import {
  OptionSelect,
  ResourceTable,
  Th,
  DetailSection,
} from "@/components/dashboard/primitives"
import { TableRow, TableCell } from "@/components/ui/table"
import { FileUploadField } from "@/components/dashboard/file-upload"
import {
  IVR_DAYS,
  type IvrAction,
  type IvrPrompt,
  type IvrMenu,
  type IvrBusinessHours,
} from "@/lib/ivr"

export type PromptRenderInfo = {
  kind: string
  text?: string
  fileId?: string
  voice?: string | null
  status: string
  error?: string | null
  audio_url: string | null
}
export const PromptRendersContext = createContext<{
  renders: PromptRenderInfo[]
  voice?: string
}>({ renders: [] })
export function VoiceField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: string
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}
function AudioPreview({ fileId }: { fileId: string }) {
  const url = useTeamQuery(api.calling.playgroundState.audio, { fileId })
  return url ? <AudioPlayer src={url} label="IVR prompt" /> : null
}
export function PromptField({
  value,
  onChange,
}: {
  value: IvrPrompt
  onChange: (v: IvrPrompt) => void
}) {
  const context = useContext(PromptRendersContext)
  const rendered = context.renders.find((r) =>
    value.kind === "tts"
      ? r.kind === "tts" &&
        r.text === value.text &&
        r.voice === (value.voice ?? context.voice ?? null)
      : r.fileId === value.fileId
  )
  return (
    <div className="flex flex-col gap-3">
      <OptionSelect
        aria-label="Prompt source"
        value={value.kind}
        onChange={(kind) =>
          onChange(
            kind === "tts"
              ? { kind: "tts", text: "" }
              : { kind: "audio", fileId: "" }
          )
        }
        items={[
          { value: "tts", label: "Typed text" },
          { value: "audio", label: "Uploaded audio" },
        ]}
      />
      {rendered?.error ? (
        <p role="alert" className="text-destructive">
          {rendered.error}
        </p>
      ) : null}
      {value.kind === "tts" ? (
        <>
          <Field>
            <FieldLabel>Prompt text</FieldLabel>
            <Textarea
              aria-label="Prompt text"
              value={value.text}
              maxLength={2000}
              onChange={(e) => onChange({ ...value, text: e.target.value })}
            />
          </Field>
          <VoiceField
            label="Voice"
            value={value.voice ?? ""}
            onChange={(voice) =>
              onChange({
                kind: "tts",
                text: value.text,
                ...(voice ? { voice } : {}),
              })
            }
          />
          <p className="text-sm text-muted-foreground">
            {rendered?.status ?? "pending_render"} · Save with a team provider
            key to render audio.
          </p>
          {rendered?.audio_url ? (
            <AudioPlayer src={rendered.audio_url} label="Rendered IVR prompt" />
          ) : null}
        </>
      ) : (
        <>
          <FileUploadField
            use="ivr"
            label="Upload WAV, MP3 or OGG prompt"
            onUploaded={(fileId) => onChange({ kind: "audio", fileId })}
          />
          {value.fileId ? (
            <>
              <p className="text-sm text-muted-foreground">
                Ready · {value.fileId}
              </p>
              <AudioPreview fileId={value.fileId} />
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
const actionItems = [
  { value: "submenu", label: "Submenu" },
  { value: "agents", label: "Transfer to agents" },
  { value: "bot", label: "Voice bot" },
  { value: "voicemail", label: "Voicemail" },
  { value: "playAndHangup", label: "Play and hang up" },
  { value: "webhook", label: "Webhook decision" },
  { value: "hangup", label: "Hang up" },
]
export function ActionField({
  value,
  onChange,
  menus,
  label = "Action",
}: {
  value: IvrAction
  onChange: (v: IvrAction) => void
  menus: IvrMenu[]
  label?: string
}) {
  const bots = useTeamQuery(api.voice.resources.dashboardList, { limit: 100 })
  return (
    <div className="flex flex-col gap-2">
      <OptionSelect
        aria-label={label}
        value={value.kind}
        items={actionItems}
        onChange={(kind) => {
          switch (kind) {
            case "submenu":
              onChange({ kind, menuId: menus[0]?.id ?? "" })
              break
            case "bot":
              onChange({ kind, botId: "" })
              break
            case "webhook":
              onChange({ kind, url: "" })
              break
            case "playAndHangup":
              onChange({ kind, prompt: { kind: "tts", text: "" } })
              break
            case "agents":
            case "voicemail":
            case "hangup":
              onChange({ kind })
              break
          }
        }}
      />
      {value.kind === "submenu" ? (
        <OptionSelect
          aria-label="Submenu"
          value={value.menuId}
          items={menus.map((m) => ({
            value: m.id,
            label: `${m.name} (${m.id})`,
          }))}
          onChange={(menuId) => onChange({ ...value, menuId })}
        />
      ) : null}
      {value.kind === "bot" ? (
        <OptionSelect
          aria-label="Voice bot"
          placeholder="Choose a voice bot"
          value={value.botId}
          items={(bots?.data ?? []).flatMap((b) =>
            "name" in b ? [{ value: b.id, label: b.name }] : []
          )}
          onChange={(botId) => onChange({ ...value, botId })}
        />
      ) : null}
      {value.kind === "webhook" ? (
        <>
          <VoiceField
            label="Webhook URL"
            value={value.url}
            onChange={(url) => onChange({ ...value, url })}
          />
          <VoiceField
            label="Webhook secret ID (optional)"
            value={value.secretId ?? ""}
            onChange={(secretId) =>
              onChange({
                kind: "webhook",
                url: value.url,
                ...(secretId ? { secretId } : {}),
              })
            }
          />
        </>
      ) : null}
      {value.kind === "playAndHangup" ? (
        <PromptField
          value={value.prompt}
          onChange={(prompt) => onChange({ ...value, prompt })}
        />
      ) : null}
    </div>
  )
}
export function MenuFields({
  menu,
  menus,
  onChange,
}: {
  menu: IvrMenu
  menus: IvrMenu[]
  onChange: (m: IvrMenu) => void
}) {
  const patch = (p: Partial<IvrMenu>) => onChange({ ...menu, ...p })
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <VoiceField
          label="Menu ID"
          value={menu.id}
          onChange={(id) => patch({ id })}
        />
        <VoiceField
          label="Menu name"
          value={menu.name}
          onChange={(name) => patch({ name })}
        />
      </div>
      <PromptField
        value={menu.prompt}
        onChange={(prompt) => patch({ prompt })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ["Timeout (seconds)", "timeoutSeconds"],
            ["Retries", "retries"],
            ["Max digits", "maxDigits"],
          ] as const
        ).map(([label, key]) => (
          <VoiceField
            key={key}
            label={label}
            type="number"
            value={menu[key]}
            onChange={(value) => patch({ [key]: Number(value) })}
          />
        ))}
      </div>
      <DetailSection
        title="Options"
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={Object.keys(menu.options).length >= 12}
            onClick={() => {
              const digit = "1234567890*#"
                .split("")
                .find((d) => !menu.options[d])
              if (digit)
                patch({
                  options: { ...menu.options, [digit]: { kind: "hangup" } },
                })
            }}
          >
            Add option
          </Button>
        }
      >
        <ResourceTable
          headers={
            <>
              <Th>Digit</Th>
              <Th>Action</Th>
              <Th />
            </>
          }
        >
          {Object.entries(menu.options).map(([digit, action]) => (
            <TableRow key={digit}>
              <TableCell className="w-28">
                <OptionSelect
                  aria-label={`Digit ${digit}`}
                  value={digit}
                  items={"0123456789*#"
                    .split("")
                    .filter((d) => d === digit || !menu.options[d])
                    .map((d) => ({ value: d, label: d }))}
                  onChange={(d) => {
                    const options = { ...menu.options }
                    delete options[digit]
                    options[d] = action
                    patch({ options })
                  }}
                />
              </TableCell>
              <TableCell>
                <ActionField
                  label={`Action for ${digit}`}
                  value={action}
                  menus={menus}
                  onChange={(a) =>
                    patch({ options: { ...menu.options, [digit]: a } })
                  }
                />
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove option ${digit}`}
                  onClick={() => {
                    const options = { ...menu.options }
                    delete options[digit]
                    patch({ options })
                  }}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      </DetailSection>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>No input</FieldLabel>
          <ActionField
            label="No input action"
            menus={menus}
            value={menu.noInputAction}
            onChange={(noInputAction) => patch({ noInputAction })}
          />
        </Field>
        <Field>
          <FieldLabel>Failure / invalid digits</FieldLabel>
          <ActionField
            label="Failure action"
            menus={menus}
            value={menu.failureAction}
            onChange={(failureAction) => patch({ failureAction })}
          />
        </Field>
      </div>
      {menu.invalidPrompt ? (
        <>
          <FieldLabel>Invalid input prompt</FieldLabel>
          <PromptField
            value={menu.invalidPrompt}
            onChange={(invalidPrompt) => patch({ invalidPrompt })}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const next = { ...menu }
              delete next.invalidPrompt
              onChange(next)
            }}
          >
            Remove invalid prompt
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => patch({ invalidPrompt: { kind: "tts", text: "" } })}
        >
          Add invalid input prompt
        </Button>
      )}
    </div>
  )
}
export function BusinessHoursFields({
  value,
  onChange,
  menus,
}: {
  value: IvrBusinessHours | undefined
  onChange: (h: IvrBusinessHours | undefined) => void
  menus: IvrMenu[]
}) {
  return (
    <DetailSection title="Business hours">
      <OptionSelect
        aria-label="Business hours"
        value={value?.status ?? "DISABLED"}
        items={[
          { value: "DISABLED", label: "Always open" },
          { value: "ENABLED", label: "Use business hours" },
        ]}
        onChange={(status) =>
          onChange(
            status === "DISABLED"
              ? undefined
              : {
                  status: "ENABLED",
                  timezone_id: "UTC",
                  weekly_operating_hours: [],
                  holiday_schedule: [],
                  closedAction: { kind: "voicemail" },
                }
          )
        }
      />
      {value?.status === "ENABLED" ? (
        <>
          <VoiceField
            label="IANA timezone"
            value={value.timezone_id ?? "UTC"}
            onChange={(timezone_id) => onChange({ ...value, timezone_id })}
          />
          <ResourceTable
            headers={
              <>
                <Th>Day</Th>
                <Th>Open (HHmm)</Th>
                <Th>Close (HHmm)</Th>
                <Th />
              </>
            }
          >
            {(value.weekly_operating_hours ?? []).map((r, i, rows) => (
              <TableRow key={i}>
                <TableCell>
                  <OptionSelect
                    aria-label={`Day ${i + 1}`}
                    value={r.day_of_week}
                    items={IVR_DAYS.map((d) => ({
                      value: d,
                      label: d.toLowerCase(),
                    }))}
                    onChange={(day) =>
                      onChange({
                        ...value,
                        weekly_operating_hours: rows.map((x, n) =>
                          n === i
                            ? { ...x, day_of_week: day as typeof r.day_of_week }
                            : x
                        ),
                      })
                    }
                  />
                </TableCell>
                {(["open_time", "close_time"] as const).map((key) => (
                  <TableCell key={key}>
                    <Input
                      aria-label={`${key} ${i + 1}`}
                      value={r[key]}
                      maxLength={4}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          weekly_operating_hours: rows.map((x, n) =>
                            n === i ? { ...x, [key]: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        ...value,
                        weekly_operating_hours: rows.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={(value.weekly_operating_hours?.length ?? 0) >= 14}
            onClick={() =>
              onChange({
                ...value,
                weekly_operating_hours: [
                  ...(value.weekly_operating_hours ?? []),
                  {
                    day_of_week: "MONDAY",
                    open_time: "0900",
                    close_time: "1700",
                  },
                ],
              })
            }
          >
            Add hours
          </Button>
          <ResourceTable
            headers={
              <>
                <Th>Holiday date</Th>
                <Th>Start (HHmm)</Th>
                <Th>End (HHmm)</Th>
                <Th />
              </>
            }
          >
            {(value.holiday_schedule ?? []).map((r, i, rows) => (
              <TableRow key={i}>
                {(["date", "start_time", "end_time"] as const).map((key) => (
                  <TableCell key={key}>
                    <Input
                      aria-label={`${key} holiday ${i + 1}`}
                      type={key === "date" ? "date" : "text"}
                      value={r[key]}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          holiday_schedule: rows.map((x, n) =>
                            n === i ? { ...x, [key]: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        ...value,
                        holiday_schedule: rows.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={(value.holiday_schedule?.length ?? 0) >= 20}
            onClick={() =>
              onChange({
                ...value,
                holiday_schedule: [
                  ...(value.holiday_schedule ?? []),
                  { date: "", start_time: "0000", end_time: "0000" },
                ],
              })
            }
          >
            Add holiday
          </Button>
          <Field>
            <FieldLabel>When closed</FieldLabel>
            <ActionField
              menus={menus}
              value={value.closedAction}
              onChange={(closedAction) => onChange({ ...value, closedAction })}
            />
          </Field>
        </>
      ) : null}
    </DetailSection>
  )
}
