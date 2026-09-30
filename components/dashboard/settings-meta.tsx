"use client"
import * as React from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import {
  ArrowUpRightIcon,
  KeyRoundIcon,
  ShieldIcon,
  UnplugIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AsyncForm, FormInput } from "@/components/auth/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  EmptyState,
  MonoValue,
  RelativeTime,
  SettingsCard,
} from "@/components/dashboard/primitives"

type MetaStatus = FunctionReturnType<typeof api.meta.app.status>

/** What the super admin sets up in Meta before teams can connect. */
const PREREQUISITES = [
  {
    text: "Create a Business app, then add WhatsApp, Facebook Login for Business, Messenger and Instagram.",
    href: "https://developers.facebook.com/docs/development/create-an-app/",
  },
  {
    text: "Verify your business in Meta Business Suite.",
    href: "https://www.facebook.com/business/help/2058515294227817",
  },
  {
    text: "Request Advanced Access in App Review for whatsapp_business_management, whatsapp_business_messaging, business_management, pages_messaging and instagram_business_manage_messages.",
    href: "https://developers.facebook.com/docs/app-review",
  },
  {
    text: "Complete Tech Provider onboarding.",
    href: "https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers",
  },
  {
    text: "Add this dashboard's domain to the app's allowed domains, so the JavaScript SDK can open Embedded Signup.",
    href: "https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation",
  },
] as const

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-all">{children}</dd>
    </div>
  )
}

export function SettingsMeta() {
  const installation = useQuery(api.installation.status)
  const status = useQuery(
    api.meta.app.status,
    installation?.admin ? {} : "skip"
  )
  const verify = useAction(api.meta.appActions.verify)
  const subscribe = useAction(api.meta.appActions.subscribeWebhooks)
  const disconnect = useMutation(api.meta.app.disconnect)
  const [editing, setEditing] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  if (!installation) return <Skeleton className="h-64 max-w-3xl" />
  if (!installation.admin)
    return (
      <EmptyState
        icon={ShieldIcon}
        title="Administrator access required"
        description="Only the installation administrator can manage the Meta app."
      />
    )
  if (!status) return <Skeleton className="h-64 max-w-3xl" />
  const { connected, configIds } = status
  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="meta-settings">
      <p className="text-sm text-muted-foreground">
        Manage the Meta app every team uses to connect WhatsApp, Messenger and
        Instagram.
      </p>
      <SettingsCard
        title="Meta app"
        actions={
          <Badge variant={connected ? "success" : "warning"} dot>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        }
        footer={
          <div className="flex flex-wrap items-start gap-2">
            {connected && (
              <AsyncForm
                submitLabel="Verify"
                success="App verified"
                onSubmit={() => verify({})}
              />
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <KeyRoundIcon data-icon="inline-start" />
              {connected ? "Update app" : "Add app"}
            </Button>
            {connected && (
              <Button variant="ghost" onClick={() => setDisconnecting(true)}>
                <UnplugIcon data-icon="inline-start" />
                Disconnect
              </Button>
            )}
          </div>
        }
      >
        <dl className="grid gap-5 sm:grid-cols-2">
          <Detail label="App ID">
            <MonoValue copyValue={status.appId}>
              {status.appId ?? "Not connected"}
            </MonoValue>
          </Detail>
          <Detail label="App secret">
            {status.secretLast4
              ? `Ending in ${status.secretLast4}`
              : "Not configured"}
          </Detail>
          <Detail label="App name">{status.appName ?? "Not verified"}</Detail>
          <Detail label="Verified">
            <RelativeTime at={status.verifiedAt ?? null} fallback="Never" />
          </Detail>
        </dl>
        {status.error && (
          <p role="alert" className="text-sm text-destructive">
            {status.error}
          </p>
        )}
      </SettingsCard>
      <SettingsCard
        title="Webhook"
        description="Meta sends WhatsApp messages and status updates to this address."
        footer={
          connected ? (
            <AsyncForm
              submitLabel="Subscribe"
              success="Webhooks subscribed"
              onSubmit={() => subscribe({})}
            />
          ) : undefined
        }
      >
        <dl className="grid gap-5">
          <Detail label="Callback URL">
            <MonoValue copyValue={status.callbackUrl ?? undefined}>
              {status.callbackUrl ?? "Not configured"}
            </MonoValue>
          </Detail>
          <Detail label="Verify token">
            <MonoValue copyValue={status.verifyToken}>
              {status.verifyToken ?? "Created when you add the app"}
            </MonoValue>
          </Detail>
        </dl>
        <p className="text-xs text-muted-foreground">
          {status.webhookSubscribedAt ? (
            <>
              Subscribed <RelativeTime at={status.webhookSubscribedAt} />
            </>
          ) : (
            "Not subscribed"
          )}
        </p>
      </SettingsCard>
      <SettingsCard
        title="Signup configuration"
        description="The Facebook Login for Business configurations teams sign in with."
      >
        <dl className="grid gap-5 sm:grid-cols-2">
          <Detail label="WhatsApp Embedded Signup config ID">
            <MonoValue copyValue={configIds.whatsapp}>
              {configIds.whatsapp ?? "Not configured"}
            </MonoValue>
          </Detail>
          <Detail label="Facebook Login config ID">
            <MonoValue copyValue={configIds.facebookLogin}>
              {configIds.facebookLogin ?? "Not configured"}
            </MonoValue>
          </Detail>
          <Detail label="Graph API version">
            <MonoValue>{status.graphVersion}</MonoValue>
          </Detail>
        </dl>
      </SettingsCard>
      <SettingsCard
        title="Checklist"
        description="Finish these in Meta before teams connect. Until App Review passes, only businesses in your own portfolio can connect."
      >
        <ol className="ml-4 flex list-decimal flex-col gap-2 text-sm">
          {PREREQUISITES.map((item) => (
            <li key={item.href}>
              {item.text}{" "}
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                Meta docs
                <ArrowUpRightIcon className="size-3" />
              </a>
            </li>
          ))}
        </ol>
      </SettingsCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {connected ? "Update Meta app" : "Add Meta app"}
            </DialogTitle>
            <DialogDescription>
              Find the app ID and secret in Meta&apos;s App Dashboard under App
              settings → Basic.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65svh] overflow-y-auto py-1">
            {editing && (
              <MetaAppForm
                status={status}
                onSaved={() => {
                  setEditing(false)
                  toast.add({ type: "success", title: "Meta app saved" })
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Meta app"
        description="Teams can no longer connect Meta businesses, and Meta webhooks are refused until you add an app again."
        confirmLabel="Disconnect"
        onConfirm={() => disconnect({})}
      />
    </div>
  )
}

function MetaAppForm({
  status,
  onSaved,
}: {
  status: MetaStatus
  onSaved: () => void
}) {
  const save = useAction(api.meta.app.save)
  const text = (form: FormData, name: string) =>
    String(form.get(name) ?? "").trim()
  return (
    <AsyncForm
      fullWidth
      submitLabel="Save app"
      success={false}
      onSubmit={async (form) => {
        const appSecret = text(form, "appSecret")
        await save({
          appId: text(form, "appId"),
          ...(appSecret ? { appSecret } : {}),
          graphVersion: text(form, "graphVersion"),
          configIds: {
            whatsapp: text(form, "whatsappConfigId") || undefined,
            facebookLogin: text(form, "facebookLoginConfigId") || undefined,
          },
        })
        onSaved()
      }}
    >
      <FieldGroup>
        <FormInput
          name="appId"
          label="App ID"
          defaultValue={status.appId}
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
        />
        <FormInput
          name="appSecret"
          label="App secret"
          type="password"
          required={!status.connected}
          autoComplete="new-password"
          placeholder={
            status.secretLast4 ? `Ending in ${status.secretLast4}` : undefined
          }
        />
        {status.connected && (
          <FieldDescription>
            Leave the secret empty to keep the current one.
          </FieldDescription>
        )}
        <FormInput
          name="whatsappConfigId"
          label="WhatsApp Embedded Signup config ID"
          defaultValue={status.configIds.whatsapp}
          required={false}
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
        />
        <FormInput
          name="facebookLoginConfigId"
          label="Facebook Login config ID"
          defaultValue={status.configIds.facebookLogin}
          required={false}
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
        />
        <FormInput
          name="graphVersion"
          label="Graph API version"
          defaultValue={status.graphVersion}
          pattern="v[0-9]+\.[0-9]+"
          autoComplete="off"
        />
      </FieldGroup>
    </AsyncForm>
  )
}
