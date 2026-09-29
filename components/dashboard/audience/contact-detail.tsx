"use client"
import { useContactBroadcasts } from "@/lib/broadcasts/use-broadcasts"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { MailIcon, PlusIcon, SendIcon, UserIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DetailHeader,
  EmailStatusBadge,
  EmptyState,
  ListPagination,
  NotFoundState,
  ResourceTable,
  Surface,
  Th,
  useAutosaveDraft,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { contactTopicStatus } from "@/lib/dashboard/contacts"
import { formatDate, formatDateTime } from "@/lib/dashboard/format"
import { useReceivedList } from "@/lib/received/use-received"
import {
  asContact,
  useAudienceCommands,
  useProperties,
  useSegments,
  useTopics,
} from "@/lib/audience/use-audience"
import { actionError } from "@/lib/action-error"
import { useRecipientEmails } from "@/lib/emails/use-emails"
import type { Contact } from "@/lib/dashboard/types"

/** Reports a failed save; the stored value then shows again. */
const reportError = (caught: unknown) =>
  toast.add({ type: "error", title: actionError(caught) })

function HistorySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="frame">
        <div className="panel p-3">
          <ItemGroup>{children}</ItemGroup>
        </div>
      </div>
    </section>
  )
}

function SegmentMembership({
  contactId,
  segmentIds,
}: {
  contactId: string
  segmentIds: string[]
}) {
  const { setContactSegment } = useAudienceCommands()
  const segments = useSegments() ?? []
  const assigned = segments.filter((segment) => segmentIds.includes(segment.id))
  const available = segments.filter(
    (segment) => !segmentIds.includes(segment.id)
  )
  const toggle = (segmentId: string, member: boolean) =>
    setContactSegment(contactId, segmentId, member).catch(reportError)

  return (
    <Surface>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Segment membership</h2>
        <p className="text-sm text-muted-foreground">
          Add this contact to groups you target in broadcasts. Recipients never
          see these names.
        </p>
      </div>
      {segments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No segments yet.{" "}
          <Link href="/segments" className="underline underline-offset-4">
            Create one
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not in any segments yet.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {assigned.map((segment) => (
                <li key={segment.id}>
                  <Badge variant="secondary" size="lg" className="pr-1">
                    <Link
                      href={`/segments/${segment.id}`}
                      className="hover:underline"
                    >
                      {segment.name}
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove from ${segment.name}`}
                      onClick={() => toggle(segment.id, false)}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {available.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="w-fit" />
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add to segment
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                {available.map((segment) => (
                  <DropdownMenuItem
                    key={segment.id}
                    onClick={() => toggle(segment.id, true)}
                  >
                    {segment.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <p className="text-sm text-muted-foreground">
              In every segment.{" "}
              <Link href="/segments" className="underline underline-offset-4">
                Manage segments
              </Link>
            </p>
          )}
        </div>
      )}
    </Surface>
  )
}

/** An input that saves as you type; see `useAutosaveDraft`. */
function AutosaveInput({
  value,
  onSave,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string
  onSave: (next: string) => Promise<unknown>
}) {
  const draft = useAutosaveDraft(value, onSave)
  return <Input {...props} {...draft.props} />
}

export function ContactDetail() {
  const { id } = useParams<{ id: string }>()
  const stored = useQuery(api.contacts.get, { id })
  const segments = useSegments()
  const topics = useTopics()
  const properties = useProperties()
  const { leaving, deleteAndLeave } = useDeleteRecord("/contacts")

  if (
    stored === undefined ||
    segments === undefined ||
    topics === undefined ||
    properties === undefined
  )
    return <Skeleton className="h-64 w-full" />
  if (!stored) {
    if (leaving) return null
    return <NotFoundState icon={UserIcon} noun="contact" backHref="/contacts" />
  }
  return <ContactPage contact={asContact(stored)} onDelete={deleteAndLeave} />
}

function ContactPage({
  contact,
  onDelete,
}: {
  contact: Contact
  onDelete: (remove: () => void) => void
}) {
  const { updateContact, deleteContacts, setContactTopic } =
    useAudienceCommands()
  const topics = useTopics() ?? []
  const properties = useProperties() ?? []
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const save = (patch: Parameters<typeof updateContact>[1]) =>
    updateContact(contact.id, patch)
  const update = (patch: Parameters<typeof updateContact>[1]) =>
    save(patch).catch(reportError)

  const sends = useRecipientEmails(contact.email)
  const emails = sends.rows
  const { pageRows: emailRows, pagination: emailPagination } = sends
  const replies = useReceivedList({ address: contact.email })
  const received = replies.rows
  const broadcastList = useContactBroadcasts(contact.email)
  const broadcasts = broadcastList.pageRows

  return (
    <>
      <DetailHeader
        backHref="/contacts"
        backLabel="Contacts"
        title={contact.email}
        icon={UserIcon}
        description={`Created ${formatDate(contact.createdAt)}`}
        actions={
          <Button variant="outline" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        }
      />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="flex flex-col gap-6">
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <Surface>
              <h2 className="text-sm font-medium">Profile</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="first">First name</FieldLabel>
                  <AutosaveInput
                    id="first"
                    value={contact.firstName}
                    onSave={(firstName) => save({ firstName })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="last">Last name</FieldLabel>
                  <AutosaveInput
                    id="last"
                    value={contact.lastName}
                    onSave={(lastName) => save({ lastName })}
                  />
                </Field>
              </div>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="subscribed">
                  <span className="flex flex-col gap-1">
                    Subscribed
                    <FieldDescription>
                      Off means this contact will not receive broadcasts, even
                      if they are opted in to a topic.
                    </FieldDescription>
                  </span>
                </FieldLabel>
                <Switch
                  id="subscribed"
                  checked={!contact.unsubscribed}
                  onCheckedChange={(checked) =>
                    update({ unsubscribed: !checked })
                  }
                />
              </Field>
              {properties.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {properties.map((property) => (
                    <Field key={property.id}>
                      <FieldLabel htmlFor={`prop-${property.key}`}>
                        {property.name}
                      </FieldLabel>
                      <AutosaveInput
                        id={`prop-${property.key}`}
                        type={property.type === "number" ? "number" : "text"}
                        value={contact.properties[property.key] ?? ""}
                        placeholder={property.fallbackValue}
                        onSave={(value) =>
                          save({ properties: { [property.key]: value } })
                        }
                      />
                    </Field>
                  ))}
                </div>
              ) : null}
            </Surface>

            <SegmentMembership
              contactId={contact.id}
              segmentIds={contact.segmentIds}
            />

            <Surface className="lg:col-span-2">
              <h2 className="text-sm font-medium">Topics</h2>
              <p className="text-sm text-muted-foreground">
                Topics appear on the preference page. Public topics can be
                managed by the contact; private topics stay off that page.
              </p>
              {topics.length === 0 ? (
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
                  {topics.map((topic) => {
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
                        <TableCell className="text-muted-foreground capitalize">
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
                              ).catch(reportError)
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
        </TabsContent>
        <TabsContent value="history">
          {sends.status === "LoadingFirstPage" ||
          replies.status === "LoadingFirstPage" ||
          broadcastList.status === "LoadingFirstPage" ? (
            <Skeleton className="h-40 w-full" />
          ) : emails.length === 0 &&
            received.length === 0 &&
            broadcasts.length === 0 ? (
            <EmptyState
              icon={MailIcon}
              title="No marketing history"
              description="Sends, broadcasts, and inbound replies for this address will show here."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {emails.length > 0 ? (
                <HistorySection title="Emails">
                  {emailRows.map((email) => (
                    <Item
                      key={email.id}
                      size="sm"
                      render={<Link href={`/emails/${email.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <MailIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{email.subject}</ItemTitle>
                        <ItemDescription>
                          {formatDateTime(email.createdAt)}
                        </ItemDescription>
                      </ItemContent>
                      <EmailStatusBadge status={email.status} />
                    </Item>
                  ))}
                </HistorySection>
              ) : null}
              <ListPagination {...emailPagination} embedded noun="email" />
              {broadcasts.length > 0 ? (
                <HistorySection title="Broadcasts">
                  {broadcasts.map((broadcast) => (
                    <Item
                      key={broadcast.id}
                      size="sm"
                      render={<Link href={`/broadcasts/${broadcast.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <SendIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{broadcast.name}</ItemTitle>
                        <ItemDescription>
                          {broadcast.subject} ·{" "}
                          {formatDate(broadcast.sentAt ?? broadcast.createdAt)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                  <ListPagination
                    {...broadcastList.pagination}
                    embedded
                    noun="broadcast"
                  />
                </HistorySection>
              ) : null}
              {received.length > 0 ? (
                <HistorySection title="Received">
                  {replies.pageRows.map((email) => (
                    <Item
                      key={email.id}
                      size="sm"
                      render={<Link href={`/emails/receiving/${email.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <MailIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{email.subject}</ItemTitle>
                        <ItemDescription>
                          {formatDateTime(email.createdAt)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </HistorySection>
              ) : null}
              <ListPagination {...replies.pagination} embedded noun="email" />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${contact.email}?`}
        description="The contact is removed from every segment. This cannot be undone."
        onConfirm={() => {
          onDelete(() => void deleteContacts([contact.id]))
          toast.add({ type: "success", title: "Contact deleted" })
        }}
      />
    </>
  )
}
