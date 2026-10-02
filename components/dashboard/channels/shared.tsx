"use client"

import * as React from "react"
import Link from "next/link"
import { useInstanceChannels } from "@/lib/dashboard/use-instance-channels"
import {
  CopyIcon,
  ChevronDownIcon,
  PlusIcon,
  MailIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react"

import { CHANNELS, CHANNEL_IDS, rowChannel } from "@/lib/channels"
import {
  DetailHeader,
  DocsButton,
  IconCell,
  MoreMenu,
  copyToClipboard,
} from "@/components/dashboard/primitives"
import { channelLabel } from "@/lib/dashboard/format"
import type { BroadcastChannel } from "@/lib/dashboard/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InstagramIcon,
  MessengerIcon,
  WhatsAppIcon,
} from "@/components/brand-icons"
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
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  TypeToConfirmDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { CHANNEL_LABELS } from "@/lib/dashboard/format"
import type { Channel, MessagingChannel } from "@/lib/dashboard/types"
import { useChannelCommands } from "@/lib/channels/use-channels"

export const ChannelsIcon = RadioTowerIcon

export const CHANNEL_ICONS: Record<
  MessagingChannel,
  (props: { className?: string }) => React.ReactNode
> = {
  whatsapp: WhatsAppIcon,
  messenger: MessengerIcon,
  instagram: InstagramIcon,
}

/** A channel's mark: Lucide's mail for email, the brand's for the rest. */
export function CopyChannelHandleItem({
  account,
}: {
  account: { channel: MessagingChannel; handle: string }
}) {
  const label = CHANNELS[account.channel].handleLabel
  return (
    <DropdownMenuItem
      onClick={() => void copyToClipboard(account.handle, label)}
    >
      <CopyIcon />
      Copy {label.toLowerCase()}
    </DropdownMenuItem>
  )
}

export const channelIcon = (channel: Channel) =>
  channel === "email" ? MailIcon : CHANNEL_ICONS[channel]

/** Email and the channels it shares Templates and Messages with. */
export const MESSAGE_CHANNEL_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All channels" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: CHANNEL_LABELS.whatsapp },
]

export function ChannelCell({ channel }: { channel?: Channel }) {
  const value = rowChannel({ channel })
  return <IconCell icon={channelIcon(value)}>{channelLabel(value)}</IconCell>
}
/** The existing Email/WhatsApp creation menu used by messaging resources. */
export function ChannelCreateMenu({
  noun,
  onCreate,
}: {
  noun: "broadcast" | "template"
  onCreate: (channel: BroadcastChannel) => void
}) {
  const channels = useInstanceChannels()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button data-testid={`create-${noun}`} />}>
        <PlusIcon data-icon="inline-start" />
        Create {noun}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {MESSAGE_CHANNEL_ITEMS.filter((item) => item.value !== "all").map(
            (item) => {
              const value = item.value as BroadcastChannel
              const Icon = channelIcon(value)
              return (
                <DropdownMenuItem
                  key={value}
                  disabled={!channels?.[value === "email" ? "email" : "meta"]}
                  onClick={() => onCreate(value)}
                >
                  <Icon />
                  {channelLabel(value)}
                  {!channels?.[value === "email" ? "email" : "meta"] &&
                    " — not set up"}
                </DropdownMenuItem>
              )
            }
          )}
        </DropdownMenuGroup>
        {channels && (
          <DropdownMenuGroup>
            {(["email", "meta"] as const)
              .filter((provider) => !channels[provider])
              .map((provider) => (
                <DropdownMenuItem
                  key={provider}
                  disabled={!channels.admin}
                  render={
                    channels.admin ? (
                      <Link
                        href={
                          provider === "email"
                            ? "/instance/ses"
                            : "/instance/meta"
                        }
                      />
                    ) : undefined
                  }
                >
                  {channels.admin
                    ? provider === "email"
                      ? "Set up email"
                      : "Set up the Meta app"
                    : `${provider === "email" ? "Email" : "Meta"}: ask your instance admin`}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The Channels page's filter: every channel in the registry. */
export const CHANNEL_FILTER_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All channels" },
  ...CHANNEL_IDS.map((value) => ({ value, label: CHANNELS[value].label })),
]

/** One way to remove a channel: delete a domain, disconnect a business. */
export type ChannelRemoval = {
  label: string
  icon: LucideIcon
  disabled?: boolean
  onClick: () => void
}

/** A channel's overflow menu, on its row and on its page: the everyday
    actions, then the destructive one on its own. */
export function ChannelMenu({
  children,
  remove,
}: {
  children: React.ReactNode
  remove: ChannelRemoval
}) {
  const Icon = remove.icon
  return (
    <MoreMenu>
      <DropdownMenuGroup>{children}</DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem
          variant="destructive"
          disabled={remove.disabled}
          onClick={remove.onClick}
        >
          <Icon />
          {remove.label}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </MoreMenu>
  )
}

/** One header for an email domain's page and a channel account's: back to
    Channels, the channel's mark, then Docs, any extra action, the refresh
    (Sync or Check DNS records) and the overflow menu. */
export function ChannelDetailHeader({
  title,
  description,
  icon,
  actions,
  refresh,
  menu,
  remove,
}: {
  title: string
  description?: string
  icon: (props: { className?: string }) => React.ReactNode
  actions?: React.ReactNode
  refresh: {
    label: string
    pendingLabel: string
    pending: boolean
    disabled?: boolean
    onClick: () => void
  }
  menu: React.ReactNode
  remove: ChannelRemoval
}) {
  return (
    <DetailHeader
      backHref="/channels"
      backLabel="Channels"
      title={title}
      description={description}
      icon={icon}
      actions={
        <>
          <DocsButton />
          {actions}
          <Button
            variant="outline"
            disabled={refresh.disabled || refresh.pending}
            aria-busy={refresh.pending}
            onClick={refresh.onClick}
          >
            {refresh.pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {refresh.pending ? refresh.pendingLabel : refresh.label}
          </Button>
          <ChannelMenu remove={remove}>{menu}</ChannelMenu>
        </>
      }
    />
  )
}

/** Registers a WhatsApp number for Cloud API with a 6-digit two-step
    verification PIN, which Meta keeps and opensend.cc never stores. */
export function RegisterNumberDialog({
  account,
  onOpenChange,
}: {
  account: { id: string; handle: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const { registerNumber } = useChannelCommands()
  const [pin, setPin] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const open = account !== null

  function close(next: boolean) {
    if (!next) {
      setPin("")
      setError(null)
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!account || pending) return
    if (!/^\d{6}$/.test(pin)) {
      setError("Enter a 6-digit PIN")
      return
    }
    setPending(true)
    try {
      await registerNumber(account.id, pin)
      toast.add({ type: "success", title: "Number registered" })
      close(false)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Register number</DialogTitle>
            <DialogDescription>
              Register {account?.handle ?? "this number"} for the WhatsApp Cloud
              API. Meta asks for this PIN when the number moves to another
              provider.
            </DialogDescription>
          </DialogHeader>
          <Field className="py-4">
            <FieldLabel htmlFor="channel-pin">
              Two-step verification PIN
            </FieldLabel>
            <Input
              credential
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              id="channel-pin"
              value={pin}
              autoFocus
              onChange={(event) => {
                setPin(event.target.value)
                setError(null)
              }}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>
                Use the number&apos;s existing PIN, or choose a new one. It is
                sent to Meta and never stored here.
              </FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Later
            </DialogClose>
            <Button type="submit" disabled={pending || pin.length !== 6}>
              {pending ? "Registering…" : "Register"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Disconnects the Meta business behind an account: all its numbers stop
    sending and leave the list. Messages stay. */
export function DisconnectBusinessDialog({
  account,
  onOpenChange,
  onDisconnected,
}: {
  account: { connectionId: string; businessName: string } | null
  onOpenChange: (open: boolean) => void
  onDisconnected?: () => void
}) {
  const { disconnectBusiness } = useChannelCommands()
  return (
    <TypeToConfirmDialog
      open={account !== null}
      onOpenChange={onOpenChange}
      title={`Disconnect ${account?.businessName ?? "business"}?`}
      description="Every channel account from this business stops sending and receiving here. Messages and conversations stay, and you can connect the business again."
      phrase={account?.businessName ?? ""}
      confirmLabel="Disconnect"
      onConfirm={async () => {
        if (!account) return
        await disconnectBusiness(account.connectionId)
        toast.add({ type: "success", title: "Business disconnected" })
        onDisconnected?.()
      }}
    />
  )
}
