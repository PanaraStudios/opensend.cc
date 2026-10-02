"use client"
import { useState } from "react"
import Link from "next/link"
import { useAction } from "convex/react"
import { BookOpenIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeMatch,
} from "@/packages/sdk/src/voice/toolkit"
import {
  SectionChrome,
  DetailHeader,
  DetailSection,
  ResourceTable,
  Th,
  EmptyState,
} from "@/components/dashboard/primitives"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { FileUploadField } from "@/components/dashboard/file-upload"
import { VoiceField } from "./ivr-fields"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import { formatUploadSize } from "@/lib/storage/policy"
const statusLabel = {
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
}
export function KnowledgeList() {
  const [creating, setCreating] = useState(false),
    [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([])
  const list = useTeamQuery(api.knowledge.resources.dashboardList, {
    limit: 25,
    after,
  }) as { data: KnowledgeBase[]; has_more: boolean } | undefined
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={
        <Button onClick={() => setCreating(true)}>Create knowledge base</Button>
      }
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={BookOpenIcon}
          title="No knowledge bases"
          description="Give your bots reusable reference material."
        >
          <Button onClick={() => setCreating(true)}>
            Create knowledge base
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th>Status</Th>
              </>
            }
          >
            {list.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/playground/knowledge/${row.id}`}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell>{row.description || "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{statusLabel[row.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <div className="flex gap-2">
            <Button
              variant="outline"
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
              disabled={!list.has_more}
              onClick={() => {
                setHistory([...history, after])
                setAfter(list.data.at(-1)?.id)
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <BaseDialog close={() => setCreating(false)} /> : null}
      </Dialog>
    </SectionChrome>
  )
}
function BaseDialog({
  row,
  close,
}: {
  row?: KnowledgeBase
  close: () => void
}) {
  const { activeTeamId } = useWorkspace(),
    write = useAction(api.knowledge.resources.dashboardWrite)
  const [name, setName] = useState(row?.name ?? ""),
    [description, setDescription] = useState(row?.description ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {row ? "Edit knowledge base" : "Create knowledge base"}
        </DialogTitle>
        <DialogDescription>
          Attach this material to any of your voice bots. A Gemini provider key
          is needed for indexing and search.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError("")
          try {
            await write({
              organizationId: activeTeamId!,
              id: row?.id,
              body: JSON.stringify({ name, description }),
            })
            close()
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <VoiceField label="Name" value={name} onChange={setName} />
        <VoiceField
          label="Description"
          value={description}
          onChange={setDescription}
        />
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim()}>
            {busy ? "Saving…" : row ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
export function KnowledgeDetail({ id }: { id: string }) {
  const base = useTeamQuery(api.knowledge.resources.dashboardGet, { id }) as
    KnowledgeBase | undefined
  const list = useTeamQuery(api.knowledge.resources.dashboardList, {
    knowledgeBaseId: id,
    limit: 100,
  }) as { data: KnowledgeDocument[] } | undefined
  const { activeTeamId } = useWorkspace(),
    write = useAction(api.knowledge.resources.dashboardWrite),
    search = useAction(api.knowledge.search.dashboardSearch)
  const [mode, setMode] = useState<KnowledgeDocument["source"]>(),
    [editing, setEditing] = useState<KnowledgeDocument>(),
    [editBase, setEditBase] = useState(false),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [matches, setMatches] = useState<KnowledgeMatch[]>(),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<string>()
  if (!base || !list) return <Skeleton className="h-60 w-full" />
  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        backHref="/playground/knowledge"
        backLabel="Knowledge bases"
        title={base.name}
        icon={BookOpenIcon}
        actions={
          <Button variant="outline" onClick={() => setEditBase(true)}>
            Edit
          </Button>
        }
      />
      {base.description ? (
        <p className="text-sm text-muted-foreground">{base.description}</p>
      ) : null}
      <DetailSection title="Documents">
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => setMode("upload")}>Upload document</Button>
          <Button variant="outline" onClick={() => setMode("url")}>
            Add URL
          </Button>
          <Button variant="outline" onClick={() => setMode("text")}>
            Paste text
          </Button>
        </div>
        {!list.data.length ? (
          <p className="text-sm text-muted-foreground">
            Add a PDF, text, Markdown or DOCX document, a public URL, or pasted
            text.
          </p>
        ) : (
          <ResourceTable
            headers={
              <>
                <Th>Title</Th>
                <Th>Source</Th>
                <Th>Size</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </>
            }
          >
            {list.data.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium">{doc.title}</TableCell>
                <TableCell>
                  {
                    {
                      upload: "Uploaded file",
                      url: "URL",
                      text: "Pasted text",
                    }[doc.source]
                  }
                </TableCell>
                <TableCell>
                  {doc.byteSize ? formatUploadSize(doc.byteSize) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{statusLabel[doc.status]}</Badge>
                  {doc.error ? (
                    <p className="mt-1 max-w-sm text-sm text-destructive">
                      {doc.error}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(doc)
                        setMode(doc.source)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={doc.status === "processing"}
                      onClick={async () => {
                        try {
                          await write({
                            organizationId: activeTeamId!,
                            id: doc.id,
                            knowledgeBaseId: id,
                            body: "{}",
                          })
                        } catch (e) {
                          setError(actionError(e))
                        }
                      }}
                    >
                      Re-index
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting === doc.id}
                      onClick={async () => {
                        setDeleting(doc.id)
                        try {
                          await write({
                            organizationId: activeTeamId!,
                            id: doc.id,
                            knowledgeBaseId: id,
                            remove: true,
                            body: "{}",
                          })
                        } catch (e) {
                          setError(actionError(e))
                        } finally {
                          setDeleting(undefined)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
        )}
      </DetailSection>
      <DetailSection title="Test search">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError("")
            try {
              const result = await search({
                organizationId: activeTeamId!,
                knowledgeBaseIds: [id as Id<"knowledgeBases">],
                query,
              })
              setMatches(result.data)
            } catch (e) {
              setError(actionError(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <VoiceField
            label="Ask a question"
            value={query}
            onChange={setQuery}
          />
          <Button className="self-start" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </Button>
        </form>
        {matches?.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No matching ready documents.
          </p>
        ) : null}
        {matches?.map((match) => (
          <div key={match.id} className="mt-4 border-t pt-4">
            <p className="text-sm font-medium">{match.title}</p>
            <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
              {match.text}
            </p>
          </div>
        ))}
      </DetailSection>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog
        open={!!mode}
        onOpenChange={(open) => {
          if (!open) {
            setMode(undefined)
            setEditing(undefined)
          }
        }}
      >
        {mode ? (
          <DocumentDialog
            key={editing?.id ?? mode}
            baseId={id}
            source={mode}
            row={editing}
            close={() => {
              setMode(undefined)
              setEditing(undefined)
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={editBase} onOpenChange={setEditBase}>
        {editBase ? (
          <BaseDialog row={base} close={() => setEditBase(false)} />
        ) : null}
      </Dialog>
      <Button
        className="self-start"
        variant="ghost"
        onClick={() => setDeleting(id)}
      >
        Delete knowledge base
      </Button>
      <Dialog
        open={deleting === id}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {base.name}?</DialogTitle>
            <DialogDescription>
              This removes its documents and search chunks. Bots will no longer
              be able to use this material.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await write({
                    organizationId: activeTeamId!,
                    id,
                    remove: true,
                    body: "{}",
                  })
                  window.location.assign("/playground/knowledge")
                } catch (e) {
                  setError(actionError(e))
                  setDeleting(undefined)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function DocumentDialog({
  baseId,
  source,
  row,
  close,
}: {
  baseId: string
  source: KnowledgeDocument["source"]
  row?: KnowledgeDocument
  close: () => void
}) {
  const full = useTeamQuery(
    api.knowledge.resources.dashboardDocument,
    { id: row?.id ?? "" },
    { enabled: !!row }
  ) as KnowledgeDocument | undefined
  if (row && !full)
    return (
      <DialogContent>
        <DialogTitle>Edit document</DialogTitle>
        <Skeleton className="h-40" />
      </DialogContent>
    )
  return (
    <DocumentForm
      key={full?.revision ?? "new"}
      baseId={baseId}
      source={source}
      row={full}
      close={close}
    />
  )
}
function DocumentForm({
  baseId,
  source,
  row,
  close,
}: {
  baseId: string
  source: KnowledgeDocument["source"]
  row?: KnowledgeDocument
  close: () => void
}) {
  const { activeTeamId } = useWorkspace(),
    write = useAction(api.knowledge.resources.dashboardWrite)
  const [title, setTitle] = useState(row?.title ?? ""),
    [value, setValue] = useState(row?.text ?? row?.url ?? ""),
    [fileId, setFileId] = useState<string | undefined>(row?.fileId),
    [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {row
            ? "Edit document"
            : { upload: "Upload document", text: "Paste text", url: "Add URL" }[
                source
              ]}
        </DialogTitle>
        <DialogDescription>
          Documents are indexed with your team’s Gemini key. Editing re-indexes
          the contents.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError("")
          try {
            await write({
              organizationId: activeTeamId!,
              id: row?.id,
              knowledgeBaseId: baseId,
              body: JSON.stringify({
                title,
                source,
                ...(source === "text"
                  ? { text: value }
                  : source === "url"
                    ? { url: value }
                    : { fileId }),
              }),
            })
            close()
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <VoiceField label="Title" value={title} onChange={setTitle} />
        {source === "upload" ? (
          <>
            <FileUploadField
              use="knowledge"
              accept=".pdf,.txt,.md,.docx"
              label={row ? "Replace file (optional)" : "Document"}
              onUploadingChange={setUploading}
              onUploaded={(id, file) => {
                setFileId(id)
                if (!title) setTitle(file.name)
              }}
              onRemoved={() => setFileId(row?.fileId)}
            />
            {row?.fileId ? (
              <p className="text-sm text-muted-foreground">
                The current file is retained until a replacement is saved.
              </p>
            ) : null}
          </>
        ) : source === "url" ? (
          <VoiceField
            label="Public HTTPS URL"
            value={value}
            onChange={setValue}
          />
        ) : (
          <Field>
            <FieldLabel>Document text</FieldLabel>
            <Textarea
              aria-label="Document text"
              className="min-h-56"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              uploading ||
              !title.trim() ||
              (source === "upload" ? !fileId : !value.trim())
            }
          >
            {busy ? "Saving…" : row ? "Save and re-index" : "Add document"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
