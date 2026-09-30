"use client"

import * as React from "react"
import Script from "next/script"
import { ArrowUpRightIcon, PlusIcon } from "lucide-react"

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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import { pluralize } from "@/lib/dashboard/format"
import {
  FACEBOOK_SDK_URL,
  isFacebookOrigin,
  readSignupMessage,
  signupLoginOptions,
} from "@/lib/meta/embedded-signup"
import {
  useChannelCommands,
  type ConnectedBusiness,
} from "@/lib/channels/use-channels"

/** The slice of Facebook's JavaScript SDK Embedded Signup uses. */
type FacebookSdk = {
  init(options: {
    appId: string
    autoLogAppEvents: boolean
    xfbml: boolean
    version: string
  }): void
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: ReturnType<typeof signupLoginOptions>
  ): void
}
declare global {
  interface Window {
    FB?: FacebookSdk
  }
}

/** Meta's guide to system-user access tokens, for the manual dialog. */
const TOKEN_DOCS =
  "https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/"

function connectedToast(result: ConnectedBusiness) {
  toast.add({
    type: "success",
    title: "WhatsApp connected",
    description: `${pluralize(result.accounts.length, "phone number")} added.`,
  })
}

/** What one signup has collected: the login callback brings the code, the
    window message the IDs; either may come first. */
type Signup = {
  code?: string
  wabaId?: string
  businessId?: string
  phoneNumberId?: string
  exchanging?: boolean
}

/** "Connect with Meta": WhatsApp Embedded Signup in Meta's popup. The code
    it returns lives 30 seconds, so the exchange starts as soon as both the
    code and the account IDs are in. */
export function ConnectMetaButton({
  config,
  onConnected,
}: {
  config:
    | {
        configured: boolean
        appId?: string
        configIds: { whatsapp?: string }
        graphVersion: string
      }
    | undefined
  onConnected: (result: ConnectedBusiness) => void
}) {
  const { canWrite, exchangeSignup } = useChannelCommands()
  const [sdkReady, setSdkReady] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const signup = React.useRef<Signup | null>(null)
  const appId = config?.appId
  const configId = config?.configIds.whatsapp
  const version = config?.graphVersion

  async function finish() {
    const current = signup.current
    if (
      !current?.code ||
      !current.wabaId ||
      !current.businessId ||
      current.exchanging
    )
      return
    current.exchanging = true
    try {
      const result = await exchangeSignup({
        code: current.code,
        wabaId: current.wabaId,
        businessId: current.businessId,
        phoneNumberId: current.phoneNumberId,
      })
      connectedToast(result)
      onConnected(result)
    } catch (e) {
      toast.add({
        type: "error",
        title: "Could not connect WhatsApp",
        description: actionError(e),
      })
    } finally {
      signup.current = null
      setPending(false)
    }
  }

  function stop(error?: string) {
    if (signup.current?.exchanging) return
    signup.current = null
    setPending(false)
    if (error)
      toast.add({
        type: "error",
        title: "Meta could not finish signup",
        description: error,
      })
  }

  // The window listener lives across renders; it calls the latest handlers.
  const handlers = React.useRef({ finish, stop })
  React.useEffect(() => {
    handlers.current = { finish, stop }
  })
  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin) || !signup.current) return
      const message = readSignupMessage(event.data)
      if (!message) return
      if (message.type === "finish") {
        Object.assign(signup.current, {
          wabaId: message.wabaId,
          businessId: message.businessId,
          phoneNumberId: message.phoneNumberId,
        })
        void handlers.current.finish()
      } else
        handlers.current.stop(
          message.type === "error" ? message.message : undefined
        )
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  function start() {
    const sdk = window.FB
    if (!sdk || !configId) return
    signup.current = {}
    setPending(true)
    sdk.login((response) => {
      const code = response.authResponse?.code
      if (!code) return stop()
      if (signup.current) signup.current.code = code
      void finish()
    }, signupLoginOptions(configId))
  }

  return (
    <>
      {appId && version ? (
        <Script
          src={FACEBOOK_SDK_URL}
          strategy="lazyOnload"
          crossOrigin="anonymous"
          onReady={() => {
            window.FB?.init({
              appId,
              autoLogAppEvents: true,
              xfbml: true,
              version,
            })
            setSdkReady(!!window.FB)
          }}
        />
      ) : null}
      <Button
        disabled={!canWrite || !configId || !sdkReady || pending}
        onClick={start}
      >
        <PlusIcon />
        {pending ? "Connecting…" : "Connect with Meta"}
      </Button>
    </>
  )
}

/** Connects a WhatsApp Business Account with a system-user access token,
    for teams that cannot use Embedded Signup. */
export function ManualConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (result: ConnectedBusiness) => void
}) {
  const { connectManual } = useChannelCommands()
  const [wabaId, setWabaId] = React.useState("")
  const [token, setToken] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function close(next: boolean) {
    if (!next) {
      setWabaId("")
      setToken("")
      setError(null)
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await connectManual({ wabaId, token })
      connectedToast(result)
      close(false)
      onConnected(result)
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
            <DialogTitle>Connect manually</DialogTitle>
            <DialogDescription>
              Connect a WhatsApp Business Account with an access token from a
              system user in Meta Business Suite.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="channel-waba">
                WhatsApp Business Account ID
              </FieldLabel>
              <Input
                id="channel-waba"
                value={wabaId}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                required
                onChange={(event) => {
                  setWabaId(event.target.value)
                  setError(null)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-token">
                System user access token
              </FieldLabel>
              <Input
                id="channel-token"
                type="password"
                value={token}
                autoComplete="off"
                required
                onChange={(event) => {
                  setToken(event.target.value)
                  setError(null)
                }}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldDescription>
                  Give the system user the whatsapp_business_management and
                  whatsapp_business_messaging permissions.{" "}
                  <a
                    href={TOKEN_DOCS}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5"
                  >
                    Meta docs
                    <ArrowUpRightIcon className="size-3" />
                  </a>
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
