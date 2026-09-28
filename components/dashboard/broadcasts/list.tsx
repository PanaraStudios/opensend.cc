"use client"

import { useExportDialog } from "@/components/dashboard/export-dialog"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CopyIcon,
  EyeIcon,
  LayoutTemplateIcon,
  MegaphoneIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  audienceFilterItems,
  BROADCAST_STATUS_ITEMS,
  BroadcastsDocsSheet,
  RenameBroadcastDialog,
} from "@/components/dashboard/broadcasts/shared"
import {
  BroadcastStatusBadge,
  ConfirmDialog,
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  MoreMenu,
  PageHeader,
  ResourceTable,
  Th,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  broadcastAsTemplateInput,
  broadcastEditorHref,
  isBroadcastDraftLike,
} from "@/lib/dashboard/broadcast"
import { formatDateTime } from "@/lib/dashboard/format"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
import {
  asBroadcast,
  useBroadcastCommands,
} from "@/lib/broadcasts/use-broadcasts"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast, BroadcastStatus } from "@/lib/dashboard/types"
import { useSegmentList } from "@/lib/audience/use-audience"
import { useSaveAsTemplate } from "@/lib/templates/use-templates"

export function BroadcastsView() {
  const router = useRouter()
  const { state } = useDashboard()
  const segments = useSegmentList("")
  const {
    addBroadcast,
    updateBroadcast,
    duplicateBroadcast,
    deleteBroadcast,
    readBroadcast,
  } = useBroadcastCommands()
  const reportError = (error: unknown) =>
    toast.add({ type: "error", title: actionError(error) })
  const saveAsTemplate = useSaveAsTemplate()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [audience, setAudience] = React.useState("all")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState<Broadcast | null>(null)
  const [deleting, setDeleting] = React.useState<Broadcast | null>(null)

  const filters = {
    search: query,
    status: status === "all" ? undefined : (status as BroadcastStatus),
    audience: audience === "all" ? undefined : audience,
  }
  const list = useTeamList(
    api.broadcasts.list,
    api.broadcasts.count,
    filters,
    asBroadcast
  )
  const { rows, pageRows, pagination } = list

  async function createBroadcast() {
    try {
      const created = await addBroadcast({
        name: "Untitled",
        subject: "",
        preview: "",
        segmentId: null,
        topicId: null,
      })
      toast.add({ type: "success", title: "Draft created" })
      router.push(`/broadcasts/${created.id}/edit`)
    } catch (error) {
      reportError(error)
    }
  }

  function cloneAsTemplate(item: Broadcast) {
    void readBroadcast(item.id)
      .then((full) => saveAsTemplate(broadcastAsTemplateInput(full)))
      .catch(reportError)
  }

  const exporting = useExportDialog({
    resource: "broadcasts",
    noun: "broadcasts",
    filters,
  })

  return (
    <>
      <PageHeader title="Broadcasts">
        <DocsButton onClick={() => setDocsOpen(true)} />
        <Button onClick={createBroadcast}>
          <PlusIcon data-icon="inline-start" />
          Create broadcast
        </Button>
      </PageHeader>
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search broadcasts…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: BROADCAST_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
          {
            value: audience,
            onChange: setAudience,
            items: audienceFilterItems(segments.pageRows),
            selectedItem: audienceFilterItems(state.segments).find(
              (item) => item.value === audience
            ),
            "aria-label": "Filter by audience",
          },
        ]}
        onExport={exporting.open}
      />
      {list.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No broadcasts"
          description="Create a broadcast to email a segment at once."
        >
          <Button onClick={createBroadcast}>
            <PlusIcon data-icon="inline-start" />
            Create broadcast
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href={broadcastEditorHref(item)}
                      className="font-medium hover:underline"
                    >
                      {item.name || "Untitled"}
                    </Link>
                    {item.subject ? (
                      <span className="text-xs text-muted-foreground">
                        {item.subject}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <BroadcastStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(item.updatedAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={broadcastEditorHref(item)} />}
                      >
                        {isBroadcastDraftLike(item.status) ? (
                          <>
                            <PencilIcon />
                            Edit broadcast
                          </>
                        ) : (
                          <>
                            <EyeIcon />
                            View broadcast
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setRenaming(item)}>
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void duplicateBroadcast(item.id)
                            .then(() =>
                              toast.add({
                                type: "success",
                                title: "Broadcast duplicated",
                              })
                            )
                            .catch(reportError)
                        }}
                      >
                        <CopyIcon />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => cloneAsTemplate(item)}>
                        <LayoutTemplateIcon />
                        Clone as template
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleting(item)}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="broadcast" />
        </>
      )}
      <BroadcastsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <RenameBroadcastDialog
        open={renaming !== null}
        onOpenChange={(next) => {
          if (!next) setRenaming(null)
        }}
        name={renaming?.name ?? ""}
        onRename={(name) => {
          if (renaming)
            void updateBroadcast(renaming.id, { name })
              .then(() =>
                toast.add({ type: "success", title: "Broadcast renamed" })
              )
              .catch(reportError)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title={`Delete ${deleting?.name || "Untitled"}?`}
        description="This removes the broadcast from the workspace."
        onConfirm={() => {
          if (deleting)
            void deleteBroadcast(deleting.id)
              .then(() =>
                toast.add({ type: "success", title: "Broadcast deleted" })
              )
              .catch(reportError)
        }}
      />
    </>
  )
}
