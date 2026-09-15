"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

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
  ConfirmDelete,
  EmailStatusBadge,
  EmptyState,
  ResourceTable,
  Surface,
  Th,
} from "@/components/dashboard/primitives"
import { AudienceDetailHeader } from "@/components/dashboard/audience/shared"
import { Mail, Plus, Send, User } from "@/components/dashboard/icons"
import { contactTopicStatus } from "@/lib/dashboard/data"
import { formatDate, formatDateTime } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

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
  const { state, setContactSegments } = useDashboard()
  const assigned = state.segments.filter((segment) =>
    segmentIds.includes(segment.id)
  )
  const available = state.segments.filter(
    (segment) => !segmentIds.includes(segment.id)
  )

  return (
    <Surface>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Segment membership</h2>
        <p className="text-sm text-muted-foreground">
          Add this contact to groups you target in broadcasts. Recipients never
          see these names.
        </p>
      </div>
      {state.segments.length === 0 ? (
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
                      onClick={() =>
                        setContactSegments(
                          contactId,
                          segmentIds.filter((id) => id !== segment.id)
                        )
                      }
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
                render={<Button variant="outline" size="sm" className="w-fit" />}
              >
                <Plus data-icon="inline-start" />
                Add to segment
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                {available.map((segment) => (
                  <DropdownMenuItem
                    key={segment.id}
                    onClick={() =>
                      setContactSegments(contactId, [
                        ...segmentIds,
                        segment.id,
                      ])
                    }
                  >
                    {segment.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}
    </Surface>
  )
}

export function ContactDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, updateContact, deleteContact, setContactTopic } =
    useDashboard()
  const contact = state.contacts.find((item) => item.id === id)
  const [pendingDelete, setPendingDelete] = React.useState(false)

  if (!contact) {
    return (
      <div className="flex flex-col gap-6">
        <AudienceDetailHeader
          backHref="/contacts"
          backLabel="Contacts"
          title="Contact not found"
          icon={User}
        />
        <EmptyState
          icon={User}
          title="Contact not found"
          description="It may have been deleted from this workspace."
        >
          <Button nativeButton={false} render={<Link href="/contacts" />}>
            Back to contacts
          </Button>
        </EmptyState>
      </div>
    )
  }

  const emails = state.emails
    .filter((email) => email.to === contact.email)
    .sort((a, b) => b.createdAt - a.createdAt)
  const received = state.received
    .filter((email) => email.from.toLowerCase().includes(contact.email))
    .sort((a, b) => b.createdAt - a.createdAt)
  const broadcasts = state.broadcasts
    .filter((broadcast) => {
      if (broadcast.status !== "sent") return false
      if (broadcast.segmentId && !contact.segmentIds.includes(broadcast.segmentId)) {
        return false
      }
      return true
    })
    .sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt))

  return (
    <>
      <AudienceDetailHeader
        backHref="/contacts"
        backLabel="Contacts"
        title={contact.email}
        icon={User}
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
                        placeholder={property.fallbackValue}
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

            <SegmentMembership
              contactId={contact.id}
              segmentIds={contact.segmentIds}
            />

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
        </TabsContent>
        <TabsContent value="history">
          {emails.length === 0 && received.length === 0 && broadcasts.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No marketing history"
              description="Sends, broadcasts, and inbound replies for this address will show here."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {emails.length > 0 ? (
                <HistorySection title="Emails">
                  {emails.map((email) => (
                    <Item
                      key={email.id}
                      size="sm"
                      render={<Link href={`/emails/${email.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <Mail />
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
              {broadcasts.length > 0 ? (
                <HistorySection title="Broadcasts">
                  {broadcasts.map((broadcast) => (
                    <Item
                      key={broadcast.id}
                      size="sm"
                      render={<Link href={`/broadcasts/${broadcast.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <Send />
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
                </HistorySection>
              ) : null}
              {received.length > 0 ? (
                <HistorySection title="Received">
                  {received.map((email) => (
                    <Item
                      key={email.id}
                      size="sm"
                      render={<Link href={`/emails/receiving/${email.id}`} />}
                    >
                      <ItemMedia variant="icon">
                        <Mail />
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
            </div>
          )}
        </TabsContent>
      </Tabs>

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
