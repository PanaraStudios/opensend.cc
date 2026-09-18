"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { CalendarIcon, ChevronDownIcon, ClockIcon } from "lucide-react"

import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDraft } from "@/components/dashboard/primitives"
import { broadcastFrom, fromAddresses } from "@/lib/dashboard/broadcast"
import {
  formatScheduleHint,
  scheduleOptions,
  timeZoneLabel,
  type ScheduleOption,
} from "@/lib/dashboard/schedule"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

/* This form sits on the email paper, so it keeps the paper's own palette in
   both app themes. Anything that floats above it (menus, popovers) is app
   chrome again and uses the design-system tokens. */

const LABEL = "w-24 shrink-0 text-[13px] text-[#6b7280]"
const VALUE =
  "min-w-0 flex-1 bg-transparent text-[14px] text-[#111827] outline-none placeholder:text-[#9ca3af]"
const ACTION =
  "shrink-0 rounded-md px-1.5 py-0.5 text-[13px] text-[#6b7280] outline-none hover:bg-[#f3f4f6] hover:text-[#111827] focus-visible:bg-[#f3f4f6]"
const ROW = "flex items-center gap-3 py-2"

function PaperSelect({
  value,
  onValueChange,
  items,
  placeholder,
  testId,
  label,
}: {
  value: string
  onValueChange: (value: string) => void
  items: readonly { value: string; label: string }[]
  placeholder: string
  testId: string
  label: string
}) {
  const current = items.find((item) => item.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid={testId}
            className={cn(
              VALUE,
              "flex items-center gap-1 text-left",
              !current && "text-[#9ca3af]"
            )}
          />
        }
      >
        {current?.label ?? placeholder}
        <ChevronDownIcon className="size-3.5 text-[#9ca3af]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(String(next))}
        >
          {items.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              value={item.value}
              closeOnClick
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* A typed phrase ("in 3 days", "friday 9am") becomes a menu row showing the
   time it resolves to. Nothing is scheduled until a row is picked, and the
   field then reads as that time rather than the phrase. */
function whenText(option: ScheduleOption): string {
  return option.at === null ? option.label : formatScheduleHint(option.at)
}

function WhenField({
  sendAt,
  onSendAtChange,
}: {
  sendAt: number | null
  onSendAtChange: (value: number | null) => void
}) {
  const [selected, setSelected] = React.useState<ScheduleOption | null>(() =>
    sendAt === null ? null : { label: "", at: sendAt }
  )
  const [query, setQuery] = React.useState(selected ? whenText(selected) : "")
  /* The clock is read in handlers only, never in render; the options are
     then derived from it and the query, so the two handlers cannot disagree
     about which text is current whatever order the combobox calls them in. */
  const [now, setNow] = React.useState(0)
  const menu = React.useMemo(() => {
    /* A chosen time in the field lists every option again, not just itself. */
    const text = selected && query === whenText(selected) ? "" : query
    return { options: scheduleOptions(text, now), zone: timeZoneLabel(now) }
  }, [now, query, selected])

  return (
    <Combobox
      items={menu.options}
      filter={null}
      autoHighlight
      value={selected}
      inputValue={query}
      itemToStringLabel={whenText}
      isItemEqualToValue={(a: ScheduleOption, b: ScheduleOption) =>
        a.at === b.at
      }
      onInputValueChange={(text) => {
        setQuery(text)
        setNow(Date.now())
      }}
      onOpenChange={(open) => {
        if (open) setNow(Date.now())
      }}
      onValueChange={(option: ScheduleOption | null) => {
        setSelected(option)
        onSendAtChange(option?.at ?? null)
      }}
    >
      <ComboboxPrimitive.Input
        className={VALUE}
        aria-label="When"
        data-testid="header-when"
        placeholder="Enter a date or time…"
      />
      <ComboboxContent className="min-w-80">
        <ComboboxList>
          {(option: ScheduleOption) => (
            <ComboboxItem
              key={option.label}
              value={option}
              className="pr-1.5"
              data-testid="header-when-option"
            >
              {option.at === null ? <ClockIcon /> : <CalendarIcon />}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.at === null ? null : (
                <span className="text-xs text-muted-foreground">
                  {formatScheduleHint(option.at)}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
        <p className="border-t border-border px-2.5 py-1.5 text-right text-xs text-muted-foreground">
          {menu.zone}
        </p>
      </ComboboxContent>
    </Combobox>
  )
}

export function EmailHeaderForm({
  item,
  sendAt,
  onSendAtChange,
}: {
  item: Broadcast
  sendAt: number | null
  onSendAtChange: (value: number | null) => void
}) {
  const { state, updateBroadcast } = useDashboard()
  const [showReplyTo, setShowReplyTo] = React.useState(
    Boolean(item.replyTo?.trim())
  )
  const [showPreview, setShowPreview] = React.useState(
    Boolean(item.preview.trim())
  )
  const from = broadcastFrom(item, state.domains)
  const subject = useDraft(item.subject, (value) =>
    updateBroadcast(item.id, { subject: value })
  )
  const preview = useDraft(item.preview, (value) =>
    updateBroadcast(item.id, { preview: value })
  )
  const replyTo = useDraft(item.replyTo ?? "", (value) =>
    updateBroadcast(item.id, { replyTo: value })
  )

  return (
    <div
      data-testid="email-header-form"
      className="border-b border-[#ebebeb] pb-3"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={ROW}>
        <span className={LABEL}>From</span>
        <PaperSelect
          label="From"
          testId="header-from"
          placeholder="Select a sender"
          value={from}
          onValueChange={(next) => updateBroadcast(item.id, { from: next })}
          items={fromAddresses(state.domains).map((address) => ({
            value: address,
            label: address,
          }))}
        />
        {showReplyTo ? null : (
          <button
            type="button"
            className={ACTION}
            data-testid="header-reply-to-toggle"
            onClick={() => setShowReplyTo(true)}
          >
            Reply-To
          </button>
        )}
      </div>
      {showReplyTo ? (
        <div className={ROW}>
          <span className={LABEL}>Reply-To</span>
          <input
            {...replyTo}
            className={VALUE}
            aria-label="Reply-To"
            data-testid="header-reply-to"
            placeholder="replies@example.com"
          />
        </div>
      ) : null}
      <div className={ROW}>
        <span className={LABEL}>To</span>
        <PaperSelect
          label="Audience"
          testId="header-audience"
          placeholder="Select a segment…"
          value={item.segmentId ?? "everyone"}
          onValueChange={(next) =>
            updateBroadcast(item.id, {
              segmentId: next === "everyone" ? null : next,
            })
          }
          items={[
            { value: "everyone", label: "All contacts" },
            ...state.segments.map((segment) => ({
              value: segment.id,
              label: segment.name,
            })),
          ]}
        />
      </div>
      <div className={ROW}>
        <span className={LABEL}>Subscribe to</span>
        <PaperSelect
          label="Topic"
          testId="header-topic"
          placeholder="Select a topic"
          value={item.topicId ?? "none"}
          onValueChange={(next) =>
            updateBroadcast(item.id, {
              topicId: next === "none" ? null : next,
            })
          }
          items={[
            { value: "none", label: "No topic" },
            ...state.topics.map((topic) => ({
              value: topic.id,
              label: topic.name,
            })),
          ]}
        />
      </div>
      <div className={ROW}>
        <span className={LABEL}>When</span>
        <WhenField sendAt={sendAt} onSendAtChange={onSendAtChange} />
      </div>
      <div className="mt-1 border-t border-[#ebebeb]" />
      <div className={ROW}>
        <input
          {...subject}
          className={VALUE}
          aria-label="Subject"
          data-testid="header-subject"
          placeholder="Subject"
        />
        {showPreview ? null : (
          <button
            type="button"
            className={ACTION}
            data-testid="header-preview-toggle"
            onClick={() => setShowPreview(true)}
          >
            Preview text
          </button>
        )}
      </div>
      {showPreview ? (
        <div className={ROW}>
          <input
            {...preview}
            className={VALUE}
            aria-label="Preview text"
            data-testid="header-preview"
            placeholder="Preview text"
          />
        </div>
      ) : null}
    </div>
  )
}
