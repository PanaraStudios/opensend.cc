"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { RadioTowerIcon, TriangleAlertIcon } from "lucide-react"

import { api } from "@/convex/_generated/api"
import {
  InstagramIcon,
  MessengerIcon,
  WhatsAppIcon,
} from "@/components/brand-icons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { toast } from "@/components/ui/toast"
import {
  TypeToConfirmDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { CHANNEL_LABELS } from "@/lib/dashboard/format"
import type { MessagingChannel } from "@/lib/dashboard/types"
import { useChannelCommands } from "@/lib/channels/use-channels"
import { INSTANCE_PAGES } from "@/lib/dashboard/nav"

export const ChannelsIcon = RadioTowerIcon

export const CHANNEL_ICONS: Record<
  MessagingChannel,
  (props: { className?: string }) => React.ReactNode
> = {
  whatsapp: WhatsAppIcon,
  messenger: MessengerIcon,
  instagram: InstagramIcon,
}

export const CHANNEL_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All channels" },
  ...(Object.keys(CHANNEL_LABELS) as MessagingChannel[]).map((value) => ({
    value,
    label: CHANNEL_LABELS[value],
  })),
]

const META_APP_PAGE = INSTANCE_PAGES.find((page) => page.title === "Meta app")!

/** Why Embedded Signup cannot open yet: no Meta app, or no WhatsApp
    configuration on it. The installation admin gets a link to fix it. */
export function MetaAppAlert({
  config,
}: {
  config: { configured: boolean; configIds: { whatsapp?: string } }
}) {
  const installation = useQuery(api.installation.status)
  if (config.configured && config.configIds.whatsapp) return null
  const admin = installation?.admin === true
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>
        {config.configured
          ? "Embedded Signup is not set up"
          : "Your administrator needs to set up the Meta app"}
      </AlertTitle>
      <AlertDescription>
        {config.configured
          ? "Add the WhatsApp Embedded Signup configuration ID to the Meta app. You can still connect with an access token."
          : admin
            ? "Add your Meta app before teams connect WhatsApp, Messenger or Instagram."
            : "Ask your installation administrator to add the Meta app before you connect WhatsApp, Messenger or Instagram."}
        {admin && (
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={META_APP_PAGE.href} />}
          >
            Set up the Meta app
          </Button>
        )}
      </AlertDescription>
    </Alert>
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
            <InputOTP
              id="channel-pin"
              maxLength={6}
              inputMode="numeric"
              pattern="^\d*$"
              value={pin}
              autoFocus
              onChange={(next) => {
                setPin(next)
                setError(null)
              }}
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
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
      description="Every number from this business stops sending and receiving here. Messages and conversations stay, and you can connect the business again."
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
