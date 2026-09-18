"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useDraft } from "@/components/dashboard/primitives"
import { formatDateTime, workspaceFromAddress } from "@/lib/dashboard/format"
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

function WhenPopover({
  sendAt,
  onSendAtChange,
}: {
  sendAt: number | null
  onSendAtChange: (value: number | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button type="button" className={ACTION} data-testid="header-when" />
        }
      >
        {sendAt ? formatDateTime(sendAt) : "When"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-medium">Send time</p>
        <Input
          type="datetime-local"
          value={draft}
          aria-label="Send at"
          data-testid="header-send-at"
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSendAtChange(null)
              setDraft("")
              setOpen(false)
            }}
          >
            Send now
          </Button>
          <Button
            size="sm"
            disabled={!draft || Number.isNaN(new Date(draft).getTime())}
            onClick={() => {
              onSendAtChange(new Date(draft).getTime())
              setOpen(false)
            }}
          >
            Schedule
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
  const from = workspaceFromAddress(state.domains)
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
        <span className={cn(VALUE, "truncate")} data-testid="header-from">
          {from}
        </span>
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
        <WhenPopover sendAt={sendAt} onSendAtChange={onSendAtChange} />
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
