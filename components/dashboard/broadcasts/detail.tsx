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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Progress, ProgressValue } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { TableCell, TableRow } from "@/components/ui/table"
import { TabsContent } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { RenameBroadcastDialog } from "@/components/dashboard/broadcasts/shared"
import {
  BroadcastStatusBadge,
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  MoreMenu,
  NotFoundState,
  PanelTabs,
  ResourceTable,
  Th,
  useDeleteRecord,
  useLoadedPagination,
  ListPagination,
} from "@/components/dashboard/primitives"
import {
  audienceLabel,
  broadcastActions,
  broadcastAsTemplateInput,
  isBroadcastDraftLike,
  type BroadcastEventTab,
} from "@/lib/dashboard/broadcast"
import { parseMailbox, senderDomainOf } from "@/lib/dashboard/email-send"
import { percent } from "@/lib/dashboard/format"
import { useQuery, usePaginatedQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
import {
  useBroadcast,
  useBroadcastCommands,
} from "@/lib/broadcasts/use-broadcasts"
import { useDomainByName } from "@/lib/domains/use-domains"
import { useSegmentOptions, useTopics } from "@/lib/audience/use-audience"
import type { Broadcast, BroadcastStats } from "@/lib/dashboard/types"
import { useSaveAsTemplate } from "@/lib/templates/use-templates"

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
  const [hideTracking, setHideTracking] = React.useState(false)
  const [tab, setTab] = React.useState<BroadcastEventTab>("unsubscribed")
  const stats = item.stats
  const sender = item.from && parseMailbox(item.from)
  const domain = useDomainByName(sender ? senderDomainOf(sender) : undefined)
  const trackingOff = Boolean(
    domain && (!domain.openTracking || !domain.clickTracking)
  )
  const progress =
    stats.recipients > 0
      ? Math.round((stats.delivered / stats.recipients) * 100)
      : 0
  const events = usePaginatedQuery(
    api.broadcasts.eventList,
    { id: item.id as Id<"broadcasts">, type: tab },
    { initialNumItems: 20 }
  )
  const total = useQuery(api.broadcasts.eventCount, {
    id: item.id as Id<"broadcasts">,
    type: tab,
  })
  const { pageRows: rows, pagination } = useLoadedPagination(
    events.results,
    events,
    total
  )
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
          {events.status === "LoadingFirstPage" ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 && events.status === "Exhausted" ? (
            <EmptyState
              size="sm"
              icon={MailIcon}
              title={`No ${active.label.toLowerCase()}`}
              description={active.empty}
            />
          ) : (
            <ResourceTable
              framed={false}
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
          <ListPagination {...pagination} embedded noun="recipient" />
        </TabsContent>
      </PanelTabs>
    </>
  )
}

export function BroadcastDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const topics = useTopics() ?? []
  const {
    updateBroadcast,
    duplicateBroadcast,
    sendBroadcast,
    cancelBroadcast,
    deleteBroadcast,
  } = useBroadcastCommands()
  const reportError = (error: unknown) =>
    toast.add({ type: "error", title: actionError(error) })
  const saveAsTemplate = useSaveAsTemplate()
  const item = useBroadcast(id)
  // The broadcast's own segment resolves wherever it falls in the team's list.
  const segments = useSegmentOptions(item?.segmentId) ?? []
  const { leaving, deleteAndLeave } = useDeleteRecord("/broadcasts")
  const [pending, setPending] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  /* Drafts are authored in the full-screen editor, which lives outside the
     dashboard chrome, so this page only ever shows the report. */
  const editable = Boolean(item) && isBroadcastDraftLike(item!.status)

  React.useEffect(() => {
    if (editable) router.replace(`/broadcasts/${id}/edit`)
  }, [editable, id, router])

  if (item === undefined) return <Skeleton className="h-64 w-full" />
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
  if (editable) return null

  const broadcast = item
  const { canSend, canCancel } = broadcastActions(broadcast.status)
  const topic = topics.find((row) => row.id === broadcast.topicId)
  const audience = audienceLabel(broadcast.segmentId, segments)

  function cloneAsTemplate() {
    void saveAsTemplate(broadcastAsTemplateInput(broadcast))
  }

  function sendNow() {
    void sendBroadcast(broadcast.id)
      .then(() => toast.add({ type: "success", title: "Broadcast sent" }))
      .catch(reportError)
  }

  function cancelSend() {
    void cancelBroadcast(broadcast.id)
      .then(() => toast.add({ type: "success", title: "Broadcast canceled" }))
      .catch(reportError)
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
                    void duplicateBroadcast(broadcast.id)
                      .then((copy) => {
                        toast.add({
                          type: "success",
                          title: "Broadcast duplicated",
                        })
                        router.push(`/broadcasts/${copy.id}/edit`)
                      })
                      .catch(reportError)
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

      <BroadcastReport item={broadcast} />

      <RenameBroadcastDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        name={broadcast.name}
        onRename={(name) => {
          void updateBroadcast(broadcast.id, { name })
            .then(() =>
              toast.add({ type: "success", title: "Broadcast renamed" })
            )
            .catch(reportError)
        }}
      />
      <ConfirmDialog
        open={pending}
        onOpenChange={setPending}
        title={`Delete ${broadcast.name || "Untitled"}?`}
        description="This removes the broadcast from the workspace."
        onConfirm={() => {
          void deleteBroadcast(broadcast.id)
            .then(() => {
              toast.add({ type: "success", title: "Broadcast deleted" })
              deleteAndLeave(() => {})
            })
            .catch(reportError)
        }}
      />
    </>
  )
}
