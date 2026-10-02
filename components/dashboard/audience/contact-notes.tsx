"use client"

import * as React from "react"
import Link from "next/link"
import { useMutation, usePaginatedQuery } from "convex/react"
import { formatDistanceToNow } from "date-fns"
import { PlusIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { actionError } from "@/lib/action-error"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog, MoreMenu } from "@/components/dashboard/primitives"

export function ContactNotes({ contactId }: { contactId: string }) {
  const id = contactId as Id<"contacts">
  const { results, status, loadMore } = usePaginatedQuery(
    api.contactNotes.list,
    { contactId: id },
    { initialNumItems: 20 }
  )
  const create = useMutation(api.contactNotes.create)
  const update = useMutation(api.contactNotes.update)
  const remove = useMutation(api.contactNotes.remove)
  const [editor, setEditor] = React.useState<{
    note?: Doc<"contactNotes">
  } | null>(null)
  const [pendingDelete, setPendingDelete] =
    React.useState<Doc<"contactNotes"> | null>(null)
  const [body, setBody] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  const edit = (note?: Doc<"contactNotes">) => {
    setBody(note?.body ?? "")
    setError("")
    setEditor({ note })
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editor || pending) return
    setPending(true)
    setError("")
    try {
      if (editor.note) await update({ id: editor.note._id, body })
      else await create({ contactId: id, body })
      setEditor(null)
    } catch (caught) {
      setError(actionError(caught))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Notes</h2>
        <Button variant="outline" size="sm" onClick={() => edit()}>
          <PlusIcon />
          Add note
        </Button>
      </div>
      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-20 w-full" />
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="divide-y">
          {results.map((note) => (
            <li key={note._id} className="py-4 first:pt-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {note.author.name ||
                      (note.author.kind === "bot"
                        ? "Bot"
                        : note.author.kind === "api"
                          ? "API"
                          : "Team member")}
                  </span>
                  <time
                    dateTime={new Date(note.createdAt).toISOString()}
                    title={new Date(note.createdAt).toLocaleString()}
                  >
                    {formatDistanceToNow(note.createdAt, { addSuffix: true })}
                  </time>
                  {note.author.kind === "bot" && note.source?.callId && (
                    <Link
                      href={`/playground/calls/${note.source.callId}`}
                      className="underline underline-offset-4"
                    >
                      View call
                    </Link>
                  )}
                </div>
                <MoreMenu>
                  <DropdownMenuItem onClick={() => edit(note)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setPendingDelete(note)}
                  >
                    Delete
                  </DropdownMenuItem>
                </MoreMenu>
              </div>
              <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="ghost"
          size="sm"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(20)}
        >
          Load more
        </Button>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditor(null)
        }}
      >
        <DialogContent>
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editor?.note ? "Edit note" : "Add note"}
              </DialogTitle>
              <DialogDescription>
                Keep context for this contact. Notes are visible to your team.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="contact-note-body">Note</FieldLabel>
              <Textarea
                id="contact-note-body"
                autoFocus
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={10000}
                rows={6}
                disabled={pending}
                required
              />
              <p className="text-xs text-muted-foreground">
                {body.length.toLocaleString()} / 10,000
              </p>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !body.trim()}>
                {pending ? "Saving…" : "Save note"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete note?"
        description="This note will be permanently deleted."
        onConfirm={async () => {
          if (pendingDelete) await remove({ id: pendingDelete._id })
        }}
      />
    </section>
  )
}
