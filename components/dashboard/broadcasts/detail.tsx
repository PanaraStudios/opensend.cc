"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ChartColumnIcon,
  CopyIcon,
  LayoutTemplateIcon,
  MailIcon,
  MegaphoneIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress, ProgressValue } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { TableCell, TableRow } from "@/components/ui/table"
import { TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { RenameBroadcastDialog } from "@/components/dashboard/broadcasts/shared"
import {
  BroadcastStatusBadge,
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  MoreMenu,
  NotFoundState,
  OptionSelect,
  PanelTabs,
  ResourceTable,
  Surface,
  Th,
  useDeleteRecord,
  useDraft,
} from "@/components/dashboard/primitives"
import {
  audienceLabel,
  broadcastActions,
  broadcastAsTemplateInput,
  broadcastEventRows,
  isBroadcastEditable,
  type BroadcastEventTab,
} from "@/lib/dashboard/broadcast"
import { defaultFromAddress, percent } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast, BroadcastStats } from "@/lib/dashboard/types"

function ScheduleDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (when: number) => void
}) {
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const when = new Date(value).getTime()
    if (!value || Number.isNaN(when)) {
      setError("Pick a date and time")
      return
    }
    if (when <= Date.now()) {
      setError("Schedule a time in the future")
      return
    }
    onConfirm(when)
    onOpenChange(false)
    setValue("")
    setError(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("")
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Schedule broadcast</DialogTitle>
            <DialogDescription>
              We queue the send at this time. You can cancel until it goes out.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="brd-schedule">Send at</FieldLabel>
              <Input
                id="brd-schedule"
                type="datetime-local"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Schedule</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const EVENT_TABS: {
  value: BroadcastEventTab
  label: string
  empty: string
}[] = [
  {
    value: "unsubscribed",
    label: "Unsubscribed",
    empty: "No one has unsubscribed yet.",
  },
  {
    value: "bounced",
    label: "Bounced",
    empty: "No one has bounced yet.",
  },
  {
    value: "suppressed",
    label: "Suppressed",
    empty: "No one has been suppressed yet.",
  },
  {
    value: "complained",
    label: "Complained",
    empty: "No one has complained yet.",
  },
]

const DELIVERY_ROWS: [string, keyof BroadcastStats][] = [
  ["Recipients", "recipients"],
  ["Delivered", "delivered"],
  ["Opened", "opened"],
  ["Clicked", "clicked"],
  ["Bounced", "bounced"],
  ["Suppressed", "suppressed"],
]

const OPT_OUT_ROWS: [string, keyof BroadcastStats][] = [
  ["Unsubscribed", "unsubscribed"],
  ["Complained", "complained"],
]

function StatsTable({
  stats,
  rows,
}: {
  stats: BroadcastStats
  rows: [string, keyof BroadcastStats][]
}) {
  return (
    <ResourceTable
      headers={
        <>
          <Th>Event</Th>
          <Th>Count</Th>
          <Th>Rate</Th>
        </>
      }
    >
      {rows.map(([label, key]) => (
        <TableRow key={key}>
          <TableCell className="font-medium">{label}</TableCell>
          <TableCell className="text-muted-foreground">
            {stats[key].toLocaleString()}
          </TableCell>
          <TableCell className="text-muted-foreground">
            {percent(stats[key], stats.recipients)}
          </TableCell>
        </TableRow>
      ))}
    </ResourceTable>
  )
}

function BroadcastReport({ item }: { item: Broadcast }) {
  const { state } = useDashboard()
  const [hideTracking, setHideTracking] = React.useState(false)
  const [tab, setTab] = React.useState<BroadcastEventTab>("unsubscribed")
  const stats = item.stats
  const domain = state.domains.find((row) => row.status === "verified")
  const trackingOff = Boolean(
    domain && (!domain.openTracking || !domain.clickTracking)
  )
  const progress =
    stats.recipients > 0
      ? Math.round((stats.delivered / stats.recipients) * 100)
      : 0
  const rows = broadcastEventRows(state, item, tab)
  const active =
    EVENT_TABS.find((entry) => entry.value === tab) ?? EVENT_TABS[0]

  return (
    <>
      {item.status === "queued" ? (
        <Alert>
          <Spinner />
          <AlertTitle>Metrics update as emails go out</AlertTitle>
          <AlertDescription>
            <Progress value={progress} className="max-w-xs">
              <ProgressValue />
            </Progress>
          </AlertDescription>
        </Alert>
      ) : null}
      {trackingOff && !hideTracking && domain ? (
        <Alert>
          <ChartColumnIcon />
          <AlertTitle>
            Click and open metrics are hidden because tracking is off on{" "}
            {domain.name}.
          </AlertTitle>
          <AlertDescription>
            <Link href={`/domains/${domain.id}`}>
              Open {domain.name} settings
            </Link>
            .
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              onClick={() => setHideTracking(true)}
            >
              <XIcon />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Deliverability</h2>
            <p className="text-sm text-muted-foreground">
              {percent(stats.delivered, stats.recipients)} of recipients
              received this send.
            </p>
          </div>
          <StatsTable stats={stats} rows={DELIVERY_ROWS} />
        </section>
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Opt-out</h2>
            <p className="text-sm text-muted-foreground">
              {percent(stats.unsubscribed + stats.complained, stats.recipients)}{" "}
              unsubscribed or complained.
            </p>
          </div>
          <StatsTable stats={stats} rows={OPT_OUT_ROWS} />
        </section>
      </div>
      <PanelTabs
        value={tab}
        onValueChange={(next) => setTab(next as BroadcastEventTab)}
        tabs={EVENT_TABS}
      >
        <TabsContent value={tab} className="p-5">
          {rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={MailIcon}
              title={`No ${active.label.toLowerCase()}`}
              description={active.empty}
            />
          ) : (
            <ResourceTable
              headers={
                <>
                  <Th>Email</Th>
                </>
              }
            >
              {rows.map((row) => (
                <TableRow key={row.email}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                </TableRow>
              ))}
            </ResourceTable>
          )}
        </TabsContent>
      </PanelTabs>
    </>
  )
}

function BroadcastComposer({
  item,
  sendError,
  onSubjectChange,
}: {
  item: Broadcast
  sendError: string | null
  onSubjectChange: () => void
}) {
  const { state, updateBroadcast } = useDashboard()
  const canEdit = isBroadcastEditable(item.status)
  const verified = state.domains.find((domain) => domain.status === "verified")
  const from = defaultFromAddress(verified?.name)
  const name = useDraft(item.name, (value) =>
    updateBroadcast(item.id, { name: value })
  )
  const subject = useDraft(
    item.subject,
    (value) => updateBroadcast(item.id, { subject: value }),
    onSubjectChange
  )
  const preview = useDraft(item.preview, (value) =>
    updateBroadcast(item.id, { preview: value })
  )
  const html = useDraft(item.html, (value) =>
    updateBroadcast(item.id, { html: value })
  )

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Surface>
        <h2 className="text-sm font-medium">Details</h2>
        <Field>
          <FieldLabel htmlFor="brd-edit-name">Name</FieldLabel>
          <Input id="brd-edit-name" {...name} disabled={!canEdit} />
        </Field>
        <Field>
          <FieldLabel htmlFor="brd-edit-from">From</FieldLabel>
          <Input id="brd-edit-from" value={from} disabled />
          <FieldDescription>
            Uses the first verified domain on this workspace.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Audience</FieldLabel>
          <OptionSelect
            id="brd-edit-audience"
            className="w-full"
            value={item.segmentId ?? "everyone"}
            onChange={(next) =>
              updateBroadcast(item.id, {
                segmentId: next === "everyone" ? null : next,
              })
            }
            disabled={!canEdit}
            items={[
              { value: "everyone", label: "All contacts" },
              ...state.segments.map((segment) => ({
                value: segment.id,
                label: segment.name,
              })),
            ]}
          />
        </Field>
        <Field>
          <FieldLabel>Topic</FieldLabel>
          <OptionSelect
            id="brd-edit-topic"
            className="w-full"
            value={item.topicId ?? "none"}
            onChange={(next) =>
              updateBroadcast(item.id, {
                topicId: next === "none" ? null : next,
              })
            }
            disabled={!canEdit}
            items={[
              { value: "none", label: "No topic" },
              ...state.topics.map((row) => ({
                value: row.id,
                label: row.name,
              })),
            ]}
          />
          <FieldDescription>
            Contacts unsubscribed from this topic are skipped.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="brd-edit-subject">Subject</FieldLabel>
          <Input id="brd-edit-subject" {...subject} disabled={!canEdit} />
          {sendError ? <FieldError>{sendError}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="brd-edit-preview">Preview text</FieldLabel>
          <Input id="brd-edit-preview" {...preview} disabled={!canEdit} />
        </Field>
      </Surface>
      <Surface>
        <h2 className="text-sm font-medium">Content</h2>
        <Field>
          <FieldLabel htmlFor="brd-edit-html">HTML</FieldLabel>
          <Textarea
            id="brd-edit-html"
            rows={14}
            {...html}
            disabled={!canEdit}
            className="min-h-64 font-mono text-mono"
          />
        </Field>
      </Surface>
    </div>
  )
}

export function BroadcastDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const {
    state,
    updateBroadcast,
    duplicateBroadcast,
    setBroadcastStatus,
    deleteBroadcast,
    addTemplate,
  } = useDashboard()
  const item = state.broadcasts.find((row) => row.id === id)
  const { leaving, deleteAndLeave } = useDeleteRecord("/broadcasts")
  const [pending, setPending] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)

  if (!item) {
    if (leaving) return null
    return (
      <NotFoundState
        icon={MegaphoneIcon}
        noun="broadcast"
        backHref="/broadcasts"
      />
    )
  }

  const broadcast = item
  const report = !isBroadcastEditable(broadcast.status)
  const { canSchedule, canSend, canCancel } = broadcastActions(broadcast.status)
  const topic = state.topics.find((row) => row.id === broadcast.topicId)
  const audience = audienceLabel(broadcast.segmentId, state.segments)

  function requireSubject() {
    if (!broadcast.subject.trim()) {
      setSendError("Add a subject before sending")
      return false
    }
    setSendError(null)
    return true
  }

  function cloneAsTemplate() {
    addTemplate(broadcastAsTemplateInput(broadcast))
    toast.add({ type: "success", title: "Template created" })
  }

  function sendNow() {
    if (!requireSubject()) return
    setBroadcastStatus(broadcast.id, "sent")
    toast.add({ type: "success", title: "Broadcast sent" })
  }

  function cancelSend() {
    setBroadcastStatus(broadcast.id, "canceled")
    toast.add({ type: "success", title: "Broadcast canceled" })
  }

  return (
    <>
      <DetailHeader
        backHref="/broadcasts"
        backLabel="Broadcasts"
        title={broadcast.name || "Untitled"}
        icon={MegaphoneIcon}
        badge={<BroadcastStatusBadge status={broadcast.status} />}
        description={`${audience}${topic ? `. Topic: ${topic.name}` : ""}`}
        actions={
          <>
            {canSchedule ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (requireSubject()) setScheduleOpen(true)
                }}
              >
                Schedule
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="outline" onClick={cancelSend}>
                Cancel
              </Button>
            ) : null}
            {canSend ? <Button onClick={sendNow}>Send now</Button> : null}
            <MoreMenu>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <PencilIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const copy = duplicateBroadcast(broadcast.id)
                    toast.add({
                      type: "success",
                      title: "Broadcast duplicated",
                    })
                    if (copy) router.push(`/broadcasts/${copy.id}`)
                  }}
                >
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={cloneAsTemplate}>
                  <LayoutTemplateIcon />
                  Clone as template
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setPending(true)}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />

      {report ? (
        <BroadcastReport item={broadcast} />
      ) : (
        <BroadcastComposer
          item={broadcast}
          sendError={sendError}
          onSubjectChange={() => setSendError(null)}
        />
      )}

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onConfirm={(when) => {
          setBroadcastStatus(broadcast.id, "scheduled", when)
          toast.add({ type: "success", title: "Broadcast scheduled" })
        }}
      />
      <RenameBroadcastDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        name={broadcast.name}
        onRename={(name) => {
          updateBroadcast(broadcast.id, { name })
          toast.add({ type: "success", title: "Broadcast renamed" })
        }}
      />
      <ConfirmDialog
        open={pending}
        onOpenChange={setPending}
        title={`Delete ${broadcast.name || "Untitled"}?`}
        description="This removes the broadcast from the workspace."
        onConfirm={() => {
          deleteAndLeave(() => deleteBroadcast(broadcast.id))
          toast.add({ type: "success", title: "Broadcast deleted" })
        }}
      />
    </>
  )
}
