"use client"
import { ContactNotes } from "./contact-notes"
import { SendMessageAction } from "../conversation/send-message-action"
import {
  CallWithBot,
  CallPermissionStatus,
} from "@/components/dashboard/calling/call-with-bot"
import { CallButton } from "@/components/dashboard/calling/call-button"
import { contactIdentity } from "@/lib/dashboard/contacts"
import { useContactBroadcasts } from "@/lib/broadcasts/use-broadcasts"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  MailIcon,
  PlusIcon,
  MessagesSquareIcon,
  UserIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
  MonoValue,
  IconCell,
  RecipientOutcomeBadge,
  ResourceTable,
  SearchableSelect,
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
  useContactSegments,
  useContactIdentities,
  useHasSegments,
  useProperties,
  useSegmentOptions,
  useTopics,
} from "@/lib/audience/use-audience"
import { OPTION_LIMIT } from "@/lib/dashboard/options"
import { actionError } from "@/lib/action-error"
import { useRecipientEmails } from "@/lib/emails/use-emails"
import { useContactConversations } from "@/lib/messages/use-messages"
import { messageHref } from "@/lib/messages/links"
import { channelHandle } from "@/lib/meta/account-display"
import { CHANNELS, rowChannel } from "@/lib/channels"
import { channelIcon } from "@/components/dashboard/channels/shared"
import { ConversationRow } from "@/components/dashboard/emails/shared"
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

function SegmentMembership({ contactId }: { contactId: string }) {
  const { setContactSegment } = useAudienceCommands()
  const hasSegments = useHasSegments()
  /* A contact can be in any number of segments, and a team can have any
     number: both lists come from the server a page at a time. */
  const assigned = useContactSegments(contactId)
  const [search, setSearch] = React.useState("")
  const suggested = useSegmentOptions(null, search) ?? []
  const available = suggested.filter(
    (segment) => !assigned.results.some((row) => row._id === segment.id)
  )
  const toggle = (segmentId: string, member: boolean) =>
    setContactSegment(contactId, segmentId, member).catch(reportError)
  const { pageRows, pagination } = assigned

  return (
    <Surface>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Segment membership</h2>
        <p className="text-sm text-muted-foreground">
          Add this contact to groups you target in broadcasts. Recipients never
          see these names.
        </p>
      </div>
      {hasSegments === undefined || assigned.status === "LoadingFirstPage" ? (
        <Skeleton className="h-8 w-full" />
      ) : !hasSegments ? (
        <p className="text-sm text-muted-foreground">
          No segments yet.{" "}
          <Link href="/segments" className="underline underline-offset-4">
            Create one
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {pageRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not in any segments yet.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {pageRows.map((segment) => (
                <li key={segment._id}>
                  <Badge variant="secondary" size="lg" className="pr-1">
                    <Link
                      href={`/segments/${segment._id}`}
                      className="hover:underline"
                    >
                      {segment.name}
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove from ${segment.name}`}
                      onClick={() => toggle(segment._id, false)}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <ListPagination {...pagination} embedded noun="segment" />
          {!search &&
          available.length === 0 &&
          suggested.length < OPTION_LIMIT ? (
            <p className="text-sm text-muted-foreground">
              In every segment.{" "}
              <Link href="/segments" className="underline underline-offset-4">
                Manage segments
              </Link>
            </p>
          ) : (
            <SearchableSelect
              value=""
              onChange={(segmentId) => toggle(segmentId, true)}
              items={available.map((segment) => ({
                value: segment.id,
                label: segment.name,
              }))}
              search={{ onChange: setSearch, placeholder: "Search segments…" }}
              contentClassName="min-w-44"
              trigger={() => (
                <Button variant="outline" size="sm" className="w-fit">
                  <PlusIcon data-icon="inline-start" />
                  Add to segment
                </Button>
              )}
            />
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
  const topics = useTopics()
  const properties = useProperties()
  const { leaving, deleteAndLeave } = useDeleteRecord("/contacts")

  if (stored === undefined || topics === undefined || properties === undefined)
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
  const replies = useReceivedList(
    contact.email ? { address: contact.email } : "skip"
  )
  const received = replies.rows
  const messages = useContactConversations(contact.id)
  const broadcastList = useContactBroadcasts(contact.id)
  const broadcasts = broadcastList.pageRows

  return (
    <>
      <DetailHeader
        backHref="/contacts"
        backLabel="Contacts"
        title={contactIdentity(contact).label}
        icon={UserIcon}
        description={`Created ${formatDate(contact.createdAt)}`}
        actions={
          <>
            <SendMessageAction contact={contact} />
            <CallWithBot contactId={contact.id} />
            <Button variant="outline" onClick={() => setPendingDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="flex flex-col gap-6">
          <div className="grid min-w-0 grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            <Surface>
              <h2 className="text-sm font-medium">Profile</h2>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="contact-email">Email</FieldLabel>
                  <AutosaveInput
                    id="contact-email"
                    type="email"
                    value={contact.email ?? ""}
                    onSave={(email) => save({ email })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-phone">Phone</FieldLabel>
                  <AutosaveInput
                    id="contact-phone"
                    type="tel"
                    value={contact.phone ?? ""}
                    placeholder="+14155552671"
                    onSave={(phone) => save({ phone })}
                  />
                  <FieldDescription>
                    Include + and the country code.
                  </FieldDescription>
                </Field>
              </FieldGroup>
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

            <SegmentMembership contactId={contact.id} />

            <section className="flex flex-col gap-3 lg:col-span-2">
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
                            aria-label={
                              subscription === "subscribed"
                                ? `Unsubscribe ${topic.name}`
                                : `Subscribe ${topic.name}`
                            }
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
            </section>
          </div>
          <ContactNotes contactId={contact.id} />
          <ContactChannels contactId={contact.id} />
        </TabsContent>
        <TabsContent value="history">
          {messages.status === "LoadingFirstPage" ||
          sends.status === "LoadingFirstPage" ||
          replies.status === "LoadingFirstPage" ||
          broadcastList.status === "LoadingFirstPage" ? (
            <Skeleton className="h-40 w-full" />
          ) : messages.results.length === 0 &&
            emails.length === 0 &&
            received.length === 0 &&
            broadcasts.length === 0 ? (
            <EmptyState
              icon={MessagesSquareIcon}
              title="No history yet"
              description="Messages, broadcasts, and replies across every channel will show here."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {messages.results.length > 0 ? (
                <HistorySection title="Messages">
                  {messages.pageRows.map(
                    ({ conversation, accountHandle, latest }) => (
                      <ConversationRow
                        key={conversation._id}
                        conversation={conversation}
                        title={
                          conversation.channel === "email"
                            ? accountHandle
                            : channelHandle(
                                conversation.channel,
                                accountHandle
                              ) || CHANNELS[conversation.channel].label
                        }
                        render={
                          <Link href={messageHref(latest.kind, latest.id)} />
                        }
                      />
                    )
                  )}
                  <ListPagination
                    {...messages.pagination}
                    embedded
                    noun="conversation"
                  />
                </HistorySection>
              ) : null}
              {contact.email && emails.length > 0 ? (
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
              {contact.email ? (
                <ListPagination {...emailPagination} embedded noun="email" />
              ) : null}
              {broadcasts.length > 0 ? (
                <HistorySection title="Broadcasts">
                  {broadcasts.map((broadcast) => {
                    const Icon = channelIcon(rowChannel(broadcast))
                    return (
                      <Item
                        key={broadcast.id}
                        size="sm"
                        render={<Link href={`/broadcasts/${broadcast.id}`} />}
                      >
                        <ItemMedia variant="icon">
                          <Icon />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{broadcast.name}</ItemTitle>
                          <ItemDescription>
                            {broadcast.subject} ·{" "}
                            {formatDate(
                              broadcast.sentAt ?? broadcast.createdAt
                            )}
                          </ItemDescription>
                        </ItemContent>
                        <RecipientOutcomeBadge
                          skipReason={broadcast.recipient.skipReason}
                          messageStatus={broadcast.messageStatus}
                          failed={broadcast.recipient.failed}
                          sent={
                            broadcast.recipient.sent ??
                            !!broadcast.recipient.emailId
                          }
                        />
                      </Item>
                    )
                  })}
                  <ListPagination
                    {...broadcastList.pagination}
                    embedded
                    noun="broadcast"
                  />
                </HistorySection>
              ) : null}
              {contact.email && received.length > 0 ? (
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
              {contact.email ? (
                <ListPagination {...replies.pagination} embedded noun="email" />
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${contactIdentity(contact).label}?`}
        description="The contact is removed from every segment. This cannot be undone."
        onConfirm={() => {
          onDelete(() => void deleteContacts([contact.id]))
          toast.add({ type: "success", title: "Contact deleted" })
        }}
      />
    </>
  )
}

function ContactChannels({ contactId }: { contactId: string }) {
  const identities = useContactIdentities(contactId)
  return (
    <section className="flex flex-col gap-3" aria-label="Contact channels">
      <h2 className="text-sm font-medium">Channels</h2>
      <p className="text-sm text-muted-foreground">
        Linked messaging identities and the accounts they belong to.
      </p>
      {identities.status === "LoadingFirstPage" ? (
        <Skeleton className="h-24 w-full" />
      ) : identities.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No linked channel identities yet.
        </p>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Channel</Th>
              <Th>Username / handle</Th>
              <Th>Page / account</Th>
              <Th>Last inbound</Th>
              <Th>ID</Th>
            </>
          }
        >
          {identities.pageRows.map(({ identity, accounts }) => (
            <TableRow key={identity._id}>
              <TableCell>
                <IconCell icon={channelIcon(identity.channel)}>
                  {CHANNELS[identity.channel].label}
                </IconCell>
              </TableCell>
              <TableCell>
                {identity.username
                  ? channelHandle(identity.channel, identity.username)
                  : identity.phone || "—"}
              </TableCell>
              <TableCell>
                {accounts.length ? (
                  <div className="flex flex-col gap-2">
                    {accounts.map((account) => (
                      <div key={account.id} className="flex items-center gap-2">
                        <span>{account.name}</span>
                        {identity.channel === "whatsapp" ? (
                          <>
                            <CallButton
                              accountId={account.id}
                              recipient={identity.userId ?? identity.externalId}
                            />
                            <CallPermissionStatus
                              contactId={contactId}
                              accountId={account.id}
                            />
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                {identity.lastInboundAt
                  ? formatDateTime(identity.lastInboundAt)
                  : "—"}
              </TableCell>
              <TableCell>
                <MonoValue copyValue={identity.externalId}>
                  {identity.externalId}
                </MonoValue>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <ListPagination
        {...identities.pagination}
        embedded
        noun="identity"
        plural="identities"
      />
    </section>
  )
}
