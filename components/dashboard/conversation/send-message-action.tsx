"use client"
import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { SendIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import {
  OptionSelect,
  ListPagination,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  useTeamRole,
  useWorkspace,
  useTeamQuery,
} from "@/components/auth/workspace"
import { useContactSearch } from "@/lib/audience/use-audience"
import { contactIdentity } from "@/lib/dashboard/contacts"
import { actionError } from "@/lib/action-error"
import { threadHref } from "@/lib/messages/links"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { defaultSendChannel } from "@/lib/dashboard/send-channels"
import { CHANNELS, CHANNEL_IDS } from "@/lib/channels"
import type { Contact, Channel } from "@/lib/dashboard/types"

const SEND_CHANNELS = CHANNEL_IDS
const CHANNEL_ITEMS = SEND_CHANNELS.map((value) => ({
  value,
  label: CHANNELS[value].label,
}))
export function SendMessageAction({ contact }: { contact?: Contact }) {
  const [open, setOpen] = React.useState(false)
  const { canWrite } = useTeamRole()
  return (
    <>
      <Button
        variant="outline"
        disabled={!canWrite}
        onClick={() => setOpen(true)}
      >
        <SendIcon />
        Send message
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send message</DialogTitle>
            <DialogDescription>
              Choose the contact and sender, then compose your message.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <StartConversationForm
              contact={contact}
              onStarted={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
function StartConversationForm({
  contact,
  onStarted,
}: {
  contact?: Contact
  onStarted: () => void
}) {
  const router = useRouter()
  const { activeTeamId } = useWorkspace()
  const [search, setSearch] = React.useState("")
  const contacts = useContactSearch(search, !contact)
  const [contactId, setContactId] = React.useState(contact?.id)
  const connected =
    useTeamQuery(api.conversations.connectedChannels, { sending: true }) ?? []
  const [chosenChannel, setChannel] = React.useState<Channel>()
  const [pickedContact, setPickedContact] =
    React.useState<(typeof contacts)[number]>()
  const selectedContact = contact ?? pickedContact
  const channel =
    chosenChannel && connected.includes(chosenChannel)
      ? chosenChannel
      : defaultSendChannel(connected, selectedContact)
  const [accountId, setAccountId] = React.useState<string>()
  const [pending, setPending] = React.useState(false)
  const start = useMutation(api.conversations.start)
  const accounts = useTeamList(
    api.meta.connect.listAccounts,
    api.meta.connect.countAccounts,
    { channel: channel === "email" ? undefined : channel }
  )
  const items = accounts.pageRows
    .filter(
      (row) =>
        row.status === "active" &&
        (row.channel !== "whatsapp" || row.registeredAt !== undefined)
    )
    .map((row) => ({
      value: row._id,
      label: `${row.displayName || row.handle} · ${row.handle}`,
    }))
  const contactItems = contacts.map((row) => ({
    value: row.id,
    label: contactIdentity(row).label,
  }))
  const selected = selectedContact
    ? {
        value: selectedContact.id,
        label: contactIdentity(selectedContact).label,
      }
    : contactItems.find((item) => item.value === contactId)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!activeTeamId || !channel || !contactId || pending) return
        setPending(true)
        try {
          const id = await start({
            organizationId: activeTeamId,
            contactId: contactId as Id<"contacts">,
            channel,
            ...(channel !== "email"
              ? { accountId: accountId as Id<"channelAccounts"> }
              : {}),
          })
          onStarted()
          router.push(threadHref(id))
        } catch (error) {
          toast.add({ type: "error", title: actionError(error) })
        } finally {
          setPending(false)
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="send-contact">Contact</FieldLabel>
          <OptionSelect
            id="send-contact"
            value={contactId}
            selectedItem={selected}
            items={contact ? [selected!] : contactItems}
            onChange={(id) => {
              setContactId(id)
              setPickedContact(contacts.find((contact) => contact.id === id))
              setChannel(undefined)
              setAccountId(undefined)
            }}
            disabled={!!contact}
            search={
              contact
                ? undefined
                : { onChange: setSearch, placeholder: "Search contacts…" }
            }
            placeholder="Choose a contact"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="send-channel">Channel</FieldLabel>
          <OptionSelect
            id="send-channel"
            value={channel}
            items={CHANNEL_ITEMS.filter((item) =>
              connected.includes(item.value)
            )}
            onChange={(value) => {
              setChannel(value as Channel)
              setAccountId(undefined)
            }}
          />
        </Field>
        {!channel ? (
          <FieldDescription>
            Connect a sending channel in Channels to send a message.
          </FieldDescription>
        ) : null}
        {channel && channel !== "email" ? (
          <Field>
            <FieldLabel htmlFor="send-account">Sender</FieldLabel>
            <OptionSelect
              id="send-account"
              value={accountId}
              items={items}
              onChange={setAccountId}
              placeholder="Choose a sender"
            />
            <ListPagination {...accounts.pagination} embedded noun="account" />
            <FieldDescription>
              {channel === "whatsapp"
                ? "Outside the 24-hour window, start with an approved template. New conversations open the template picker."
                : "Choose the account where this contact has messaged you. Replies need an open 24-hour window."}
            </FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
      <Button
        type="submit"
        disabled={
          !channel ||
          !contactId ||
          (channel !== "email" && !accountId) ||
          pending
        }
      >
        Continue to conversation
      </Button>
    </form>
  )
}
