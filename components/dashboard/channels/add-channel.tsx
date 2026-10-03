"use client"

import * as React from "react"
import { ChevronDownIcon, KeyRoundIcon, MailIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DisabledTooltip } from "@/components/ui/tooltip"
import { AddDomainDialog } from "@/components/dashboard/domains/add-domain"
import { CHANNEL_ICONS } from "@/components/dashboard/channels/shared"
import {
  ManualConnectDialog,
  useMetaConnect,
} from "@/components/dashboard/channels/connect-meta"
import { useTeamRole } from "@/components/auth/workspace"
import { CHANNELS, type MessagingChannel } from "@/lib/channels"
import {
  useMetaPublicConfig,
  type ConnectedBusiness,
} from "@/lib/channels/use-channels"

/** "Add channel": an email domain in its dialog, or a WhatsApp number, Page
    or Instagram account through Meta's login. A channel whose login is not
    configured opens the access-token dialog instead. Render `menu` where
    the button goes (the header, an empty state) and `dialogs` once. */
export function useAddChannel({
  onConnected,
}: {
  onConnected: (result: ConnectedBusiness) => void
}) {
  const { canWrite } = useTeamRole()
  const meta = useMetaConnect({ config: useMetaPublicConfig(), onConnected })
  const [domainOpen, setDomainOpen] = React.useState(false)
  const [manualOpen, setManualOpen] = React.useState(false)
  const [manualChannel, setManualChannel] =
    React.useState<MessagingChannel>("whatsapp")
  const routes = [
    { channel: "whatsapp", route: meta.whatsapp },
    { channel: "messenger", route: meta.pages },
    { channel: "instagram", route: meta.pages },
  ] as const

  function connectManually(channel: MessagingChannel) {
    setManualChannel(channel)
    setManualOpen(true)
  }

  const menu = (
    <DropdownMenu>
      <DisabledTooltip
        reason={canWrite ? null : "Create or join a team to add a channel"}
      >
        <DropdownMenuTrigger
          render={<Button data-testid="add-channel" disabled={!canWrite} />}
        >
          <PlusIcon data-icon="inline-start" />
          {meta.pending ? "Connecting…" : "Add channel"}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
      </DisabledTooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => setDomainOpen(true)}>
            <MailIcon />
            Email domain
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {routes.map(({ channel, route }) => {
            const Icon = CHANNEL_ICONS[channel]
            return (
              <DisabledTooltip key={channel} reason={route.reason}>
                <DropdownMenuItem
                  disabled={!!route.reason}
                  onClick={() =>
                    route.manual ? connectManually(channel) : route.start()
                  }
                >
                  <Icon />
                  {CHANNELS[channel].label}
                </DropdownMenuItem>
              </DisabledTooltip>
            )
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DisabledTooltip reason={meta.manualReason}>
            <DropdownMenuItem
              disabled={!!meta.manualReason}
              onClick={() => connectManually("whatsapp")}
            >
              <KeyRoundIcon />
              Use an access token
            </DropdownMenuItem>
          </DisabledTooltip>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const dialogs = (
    <>
      {meta.script}
      <AddDomainDialog open={domainOpen} onOpenChange={setDomainOpen} />
      {/* Keyed on the channel, so each opening starts on the one picked. */}
      <ManualConnectDialog
        key={manualChannel}
        open={manualOpen}
        channel={manualChannel}
        onOpenChange={setManualOpen}
        onConnected={onConnected}
      />
    </>
  )

  return { menu, dialogs }
}
