"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { MailIcon, RadioTowerIcon } from "lucide-react"
import { EmptyState } from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useInstanceChannels } from "@/lib/dashboard/use-instance-channels"

/** The same unavailable state for every provider-dependent dashboard surface. */
export function InstanceChannelConfiguration({
  children,
  channel,
  required = true,
}: {
  children?: ReactNode
  channel: "email" | "meta"
  required?: boolean
}) {
  const channels = useInstanceChannels(required)
  if (!required) return children
  if (!channels) return <Skeleton className="h-40 w-full" />
  if (channels[channel]) return children
  const email = channel === "email"
  return (
    <EmptyState
      icon={email ? MailIcon : RadioTowerIcon}
      title={
        email
          ? "Email isn't set up on this instance"
          : "Meta isn't set up on this instance"
      }
      description={
        channels.admin
          ? email
            ? "Connect Amazon SES to send email."
            : "Set up the Meta app to connect WhatsApp, Messenger and Instagram."
          : "Ask your instance admin."
      }
    >
      {channels.admin && (
        <Button
          nativeButton={false}
          render={<Link href={email ? "/instance/ses" : "/instance/meta"} />}
        >
          Set it up
        </Button>
      )}
    </EmptyState>
  )
}
/** Existing email-only screens use the shared provider state. */
export function EmailConfiguration(props: {
  children?: ReactNode
  required?: boolean
}) {
  return <InstanceChannelConfiguration channel="email" {...props} />
}
