"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  MoreMenu,
  RadioCards,
  ResourceTable,
  Th,
  useListSearch,
} from "@/components/dashboard/primitives"
import { AudienceChrome } from "@/components/dashboard/audience/shared"
import { PencilIcon, PlusIcon, TagIcon, Trash2Icon } from "lucide-react"
import { formatDate } from "@/lib/dashboard/format"
import { useAudienceCommands, useTopicList } from "@/lib/audience/use-audience"
import { actionError } from "@/lib/action-error"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  Topic,
  TopicDefault,
  TopicVisibility,
} from "@/lib/dashboard/types"

const DEFAULT_OPTIONS = [
  {
    value: "opt_out",
    label: "Opt-out",
    description: "New contacts are subscribed until they unsubscribe.",
  },
  {
    value: "opt_in",
    label: "Opt-in",
    description: "New contacts stay unsubscribed until they opt in.",
  },
] as const

const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Public",
    description: "Shown on the unsubscribe preference page.",
  },
  {
    value: "private",
    label: "Private",
    description: "Hidden from contacts. Useful for operational mail.",
  },
] as const

function TopicFormFields({
  name,
  setName,
  description,
  setDescription,
  defaultSubscription,
  setDefaultSubscription,
  visibility,
  setVisibility,
  lockDefault,
}: {
  name: string
  setName: (value: string) => void
  description: string
  setDescription: (value: string) => void
  defaultSubscription: TopicDefault
  setDefaultSubscription: (value: TopicDefault) => void
  visibility: TopicVisibility
  setVisibility: (value: TopicVisibility) => void
  lockDefault?: boolean
}) {
  return (
    <FieldGroup className="py-4">
      <Field>
        <FieldLabel htmlFor="topic-name">Name</FieldLabel>
        <Input
          id="topic-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Product updates"
          autoFocus
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="topic-description">Description</FieldLabel>
        <Textarea
          id="topic-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Shown on the preference page"
        />
      </Field>
      <Field>
        <FieldLabel>Default subscription</FieldLabel>
        <RadioCards
          value={defaultSubscription}
          onChange={setDefaultSubscription}
          disabled={lockDefault}
          options={DEFAULT_OPTIONS}
        />
        {lockDefault ? (
          <FieldDescription>
            The default subscription cannot be changed after the topic is
            created.
          </FieldDescription>
        ) : null}
      </Field>
      <Field>
        <FieldLabel>Visibility</FieldLabel>
        <RadioCards
          value={visibility}
          onChange={setVisibility}
          options={VISIBILITY_OPTIONS}
        />
      </Field>
    </FieldGroup>
  )
}

function AddTopicDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { addTopic } = useAudienceCommands()
  const [pending, setPending] = React.useState(false)
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [defaultSubscription, setDefaultSubscription] =
    React.useState<TopicDefault>("opt_out")
  const [visibility, setVisibility] = React.useState<TopicVisibility>("public")

  function reset() {
    setName("")
    setDescription("")
    setDefaultSubscription("opt_out")
    setVisibility("public")
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    try {
      await addTopic({
        name,
        description,
        defaultSubscription,
        visibility,
      })
      toast.add({ type: "success", title: "Topic created" })
      reset()
      onOpenChange(false)
    } catch (caught) {
      toast.add({ type: "error", title: actionError(caught) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create topic</DialogTitle>
            <DialogDescription>
              Topics let contacts manage email preferences. Scope a broadcast to
              a topic so unsubscribe is precise instead of global.
            </DialogDescription>
          </DialogHeader>
          <TopicFormFields
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            defaultSubscription={defaultSubscription}
            setDefaultSubscription={setDefaultSubscription}
            visibility={visibility}
            setVisibility={setVisibility}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || pending}>
              Create topic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditTopicForm({
  topic,
  onOpenChange,
}: {
  topic: Topic
  onOpenChange: (open: boolean) => void
}) {
  const { updateTopic } = useAudienceCommands()
  const [pending, setPending] = React.useState(false)
  const [name, setName] = React.useState(topic.name)
  const [description, setDescription] = React.useState(topic.description)
  const [visibility, setVisibility] = React.useState<TopicVisibility>(
    topic.visibility
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    try {
      await updateTopic(topic.id, {
        name: name.trim(),
        description,
        visibility,
      })
      toast.add({ type: "success", title: "Topic updated" })
      onOpenChange(false)
    } catch (caught) {
      toast.add({ type: "error", title: actionError(caught) })
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Edit topic</DialogTitle>
          <DialogDescription>
            Name, description, and visibility can change. The default
            subscription cannot.
          </DialogDescription>
        </DialogHeader>
        <TopicFormFields
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          defaultSubscription={topic.defaultSubscription}
          setDefaultSubscription={() => undefined}
          visibility={visibility}
          setVisibility={setVisibility}
          lockDefault
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={!name.trim() || pending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function EditTopicDialog({
  topic,
  open,
  onOpenChange,
}: {
  topic: Topic | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {topic ? (
        <EditTopicForm
          key={topic.id}
          topic={topic}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  )
}

export function TopicsView() {
  const { deleteTopic } = useAudienceCommands()
  const { query, setQuery, search } = useListSearch()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Topic | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const topics = useTopicList(search)
  const { rows, pageRows, pagination } = topics

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton />
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Create topic
          </Button>
        </>
      }
    >
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search topics…"
      />
      {topics.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No topics"
          description="Create a topic, then attach it when you send a broadcast so contacts can unsubscribe from that type of email only."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Create topic
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th>Default</Th>
                <Th>Visibility</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((topic) => (
              <TableRow key={topic.id}>
                <TableCell className="font-medium">{topic.name}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">
                  {topic.description || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {topic.defaultSubscription === "opt_out"
                      ? "Opt-out"
                      : "Opt-in"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground capitalize">
                  {topic.visibility}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(topic.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setEditing(topic)}>
                        <PencilIcon />
                        Edit Topic
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPendingDelete(topic.id)}
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
          <ListPagination {...pagination} noun="topic" />
        </>
      )}
      <AddTopicDialog open={open} onOpenChange={setOpen} />
      <EditTopicDialog
        topic={editing}
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete topic?"
        description="Contacts lose this preference. Existing broadcasts that referenced it keep their historical topic name."
        onConfirm={async () => {
          if (pendingDelete) await deleteTopic(pendingDelete)
          toast.add({ type: "success", title: "Topic deleted" })
        }}
      />
    </AudienceChrome>
  )
}
