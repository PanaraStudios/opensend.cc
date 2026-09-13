"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, PlusIcon, UsersIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmptyState,
  FilterSelect,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  SectionTabs,
  Surface,
  Th,
  Toolbar,
} from "@/components/dashboard/primitives"
import { AUDIENCE_TABS } from "@/lib/dashboard/nav"
import { contactTopicStatus, segmentContactCount } from "@/lib/dashboard/data"
import { formatDate, isEmail } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

export function AddContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addContact, state } = useDashboard()
  const [email, setEmail] = React.useState("")
  const [firstName, setFirstName] = React.useState("")
  const [lastName, setLastName] = React.useState("")
  const [segmentIds, setSegmentIds] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setEmail("")
    setFirstName("")
    setLastName("")
    setSegmentIds([])
    setError(null)
  }

  function toggleSegment(id: string, checked: boolean) {
    setSegmentIds((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id)
    )
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!isEmail(trimmed)) {
      setError("Enter a valid email address")
      return
    }
    if (state.contacts.some((contact) => contact.email === trimmed)) {
      setError("A contact with that email already exists")
      return
    }
    const contact = addContact({
      email: trimmed,
      firstName,
      lastName,
      segmentIds,
    })
    toast.add({ type: "success", title: "Contact created" })
    reset()
    onOpenChange(false)
    router.push(`/contacts/${contact.id}`)
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
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>
              Contacts are global to the workspace and can belong to any number
              of segments and topics.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="contact-email">Email</FieldLabel>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError(null)
                }}
                placeholder="ada@example.com"
                autoFocus
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contact-first">First name</FieldLabel>
                <Input
                  id="contact-first"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-last">Last name</FieldLabel>
                <Input
                  id="contact-last"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </Field>
            </div>
            {state.segments.length > 0 ? (
              <Field>
                <FieldLabel>Add to segments</FieldLabel>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {state.segments.map((segment) => (
                    <label
                      key={segment.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={segmentIds.includes(segment.id)}
                        onCheckedChange={(checked) =>
                          toggleSegment(segment.id, checked === true)
                        }
                      />
                      {segment.name}
                    </label>
                  ))}
                </div>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add contact</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContactsView() {
  const { state, deleteContact } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [segment, setSegment] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const rows = state.contacts.filter((contact) => {
    const haystack =
      `${contact.email} ${contact.firstName} ${contact.lastName}`.toLowerCase()
    if (query && !haystack.includes(query.trim().toLowerCase())) return false
    if (segment && !contact.segmentIds.includes(segment)) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Audience"
        description="Every address you can send a broadcast to. Import, segment, and manage topic preferences from here."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Add contact
        </Button>
      </PageHeader>
      <SectionTabs items={AUDIENCE_TABS} />
      <Toolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search contacts…"
        />
        <FilterSelect
          value={segment}
          onChange={setSegment}
          placeholder="All segments"
          options={state.segments.map((item) => ({
            value: item.id,
            label: `${item.name} (${segmentContactCount(state.contacts, item.id)})`,
          }))}
        />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No contacts"
          description="Add a contact or import a CSV to start building your audience."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Add contact
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Email</Th>
              <Th>First name</Th>
              <Th>Last name</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell>
                <Link
                  href={`/contacts/${contact.id}`}
                  className="font-medium hover:underline"
                >
                  {contact.email}
                </Link>
                {contact.unsubscribed ? (
                  <Badge variant="secondary" className="ml-2">
                    Unsubscribed
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {contact.firstName || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {contact.lastName || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(contact.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem render={<Link href={`/contacts/${contact.id}`} />}>
                    Edit contact
                  </MoreMenuItem>
                  <MoreMenuItem
                    variant="destructive"
                    onClick={() => setPendingDelete(contact.id)}
                  >
                    Delete
                  </MoreMenuItem>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <AddContactDialog open={open} onOpenChange={setOpen} />
      <ConfirmDelete
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete contact?"
        description="This removes the address from every segment. Suppression history is kept separately."
        onConfirm={() => {
          if (pendingDelete) deleteContact(pendingDelete)
          toast.add({ type: "success", title: "Contact deleted" })
        }}
      />
    </>
  )
}

export function ContactDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const {
    state,
    updateContact,
    deleteContact,
    setContactSegments,
    setContactTopic,
  } = useDashboard()
  const contact = state.contacts.find((item) => item.id === id)
  const [pendingDelete, setPendingDelete] = React.useState(false)

  if (!contact) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="Contact not found"
        description="It may have been deleted from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/contacts" />}>
          Back to contacts
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/contacts" />}
        >
          <ArrowLeftIcon />
          Contacts
        </Button>
        <PageHeader title={contact.email}>
          <Button variant="outline" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        </PageHeader>
        <p className="text-sm text-muted-foreground">
          Created {formatDate(contact.createdAt)}
        </p>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Surface>
          <h2 className="text-sm font-medium">Profile</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="first">First name</FieldLabel>
              <Input
                id="first"
                value={contact.firstName}
                onChange={(event) =>
                  updateContact(contact.id, { firstName: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="last">Last name</FieldLabel>
              <Input
                id="last"
                value={contact.lastName}
                onChange={(event) =>
                  updateContact(contact.id, { lastName: event.target.value })
                }
              />
            </Field>
          </div>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="subscribed">
              <span className="flex flex-col gap-1">
                Subscribed
                <FieldDescription>
                  Off means this contact will not receive broadcasts, even if
                  they are opted in to a topic.
                </FieldDescription>
              </span>
            </FieldLabel>
            <Switch
              id="subscribed"
              checked={!contact.unsubscribed}
              onCheckedChange={(checked) =>
                updateContact(contact.id, { unsubscribed: !checked })
              }
            />
          </Field>
          {state.properties.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {state.properties.map((property) => (
                <Field key={property.id}>
                  <FieldLabel htmlFor={`prop-${property.key}`}>
                    {property.name}
                  </FieldLabel>
                  <Input
                    id={`prop-${property.key}`}
                    type={property.type === "number" ? "number" : "text"}
                    value={contact.properties?.[property.key] ?? ""}
                    onChange={(event) =>
                      updateContact(contact.id, {
                        properties: {
                          ...(contact.properties ?? {}),
                          [property.key]: event.target.value,
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          ) : null}
        </Surface>

        <Surface>
          <h2 className="text-sm font-medium">Segments</h2>
          <p className="text-sm text-muted-foreground">
            Segments are internal groups. Contacts never see these names.
          </p>
          <div className="space-y-2">
            {state.segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No segments yet.{" "}
                <Link href="/segments" className="underline underline-offset-4">
                  Create one
                </Link>
                .
              </p>
            ) : (
              state.segments.map((segment) => (
                <label
                  key={segment.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={contact.segmentIds.includes(segment.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(contact.segmentIds)
                      if (checked === true) next.add(segment.id)
                      else next.delete(segment.id)
                      setContactSegments(contact.id, [...next])
                    }}
                  />
                  {segment.name}
                </label>
              ))
            )}
          </div>
        </Surface>

        <Surface className="lg:col-span-2">
          <h2 className="text-sm font-medium">Topics</h2>
          <p className="text-sm text-muted-foreground">
            Topics appear on the preference page. Public topics can be managed
            by the contact; private topics stay off that page.
          </p>
          {state.topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No topics yet.{" "}
              <Link href="/topics" className="underline underline-offset-4">
                Create one
              </Link>
              .
            </p>
          ) : (
            <ResourceTable
              headers={
                <>
                  <Th>Topic</Th>
                  <Th>Visibility</Th>
                  <Th>Subscription</Th>
                </>
              }
            >
              {state.topics.map((topic) => {
                const subscription = contactTopicStatus(contact, topic)
                return (
                  <TableRow key={topic.id}>
                    <TableCell>
                      <div className="font-medium">{topic.name}</div>
                      {topic.description ? (
                        <div className="text-xs text-muted-foreground">
                          {topic.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {topic.visibility}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={subscription === "subscribed"}
                        onCheckedChange={(checked) =>
                          setContactTopic(
                            contact.id,
                            topic.id,
                            checked ? "subscribed" : "unsubscribed"
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </ResourceTable>
          )}
        </Surface>
      </div>

      <ConfirmDelete
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${contact.email}?`}
        description="The contact is removed from every segment. This cannot be undone."
        onConfirm={() => {
          deleteContact(contact.id)
          toast.add({ type: "success", title: "Contact deleted" })
          router.push("/contacts")
        }}
      />
    </>
  )
}
