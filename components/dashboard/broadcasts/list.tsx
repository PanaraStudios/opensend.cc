"use client"

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
  ListToolbar,
  MoreMenu,
  PageHeader,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  broadcastAsTemplateInput,
  broadcastEditorHref,
  isBroadcastDraftLike,
} from "@/lib/dashboard/broadcast"
import { formatDateTime } from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

export function BroadcastsView() {
  const router = useRouter()
  const {
    state,
    addBroadcast,
    updateBroadcast,
    duplicateBroadcast,
    deleteBroadcast,
    addTemplate,
    addExport,
  } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [audience, setAudience] = React.useState("all")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState<Broadcast | null>(null)
  const [deleting, setDeleting] = React.useState<Broadcast | null>(null)

  const needle = searchNeedle(query)
  const rows = state.broadcasts.filter((item) => {
    if (!matchesNeedle(needle, item.name, item.subject)) return false
    if (status !== "all" && item.status !== status) return false
    if (audience === "everyone") return item.segmentId === null
    return audience === "all" || item.segmentId === audience
  })

  function createBroadcast() {
    const created = addBroadcast({
      name: "Untitled",
      subject: "",
      preview: "",
      segmentId: null,
      topicId: null,
    })
    toast.add({ type: "success", title: "Draft created" })
    router.push(`/broadcasts/${created.id}/edit`)
  }

  function cloneAsTemplate(item: Broadcast) {
    addTemplate(broadcastAsTemplateInput(item))
    toast.add({ type: "success", title: "Template created" })
  }

  return (
    <>
      <PageHeader title="Broadcasts">
        <DocsButton onClick={() => setDocsOpen(true)} />
        <Button onClick={createBroadcast}>
          <PlusIcon data-icon="inline-start" />
          Create broadcast
        </Button>
      </PageHeader>
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
            items: audienceFilterItems(state.segments),
            "aria-label": "Filter by audience",
          },
        ]}
        onExport={() => {
          addExport("Broadcasts", rows.length)
          toast.add({ type: "success", title: "Export started" })
        }}
      />
      {rows.length === 0 ? (
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
          {rows.map((item) => (
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
                        duplicateBroadcast(item.id)
                        toast.add({
                          type: "success",
                          title: "Broadcast duplicated",
                        })
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
      )}
      <BroadcastsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <RenameBroadcastDialog
        open={renaming !== null}
        onOpenChange={(next) => {
          if (!next) setRenaming(null)
        }}
        name={renaming?.name ?? ""}
        onRename={(name) => {
          if (renaming) updateBroadcast(renaming.id, { name })
          toast.add({ type: "success", title: "Broadcast renamed" })
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
          if (deleting) deleteBroadcast(deleting.id)
          toast.add({ type: "success", title: "Broadcast deleted" })
        }}
      />
    </>
  )
}
