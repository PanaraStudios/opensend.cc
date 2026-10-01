"use client"

import * as React from "react"
import Script from "next/script"
import { ArrowUpRightIcon, ChevronDownIcon, PlusIcon } from "lucide-react"

import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { MessengerIcon, WhatsAppIcon } from "@/components/brand-icons"
import { facebookLoginOptions } from "@/lib/meta/facebook-login"
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
import { channelHandle } from "@/lib/meta/account-display"
import { actionError } from "@/lib/action-error"
import { CHANNEL_LABELS, pluralize } from "@/lib/dashboard/format"
import {
  FACEBOOK_SDK_URL,
  isFacebookOrigin,
  readSignupMessage,
  signupLoginOptions,
} from "@/lib/meta/embedded-signup"
import {
  useChannelCommands,
  type ConnectedBusiness,
  type ConnectedPageAccounts,
} from "@/lib/channels/use-channels"

/** The slice of Facebook's JavaScript SDK used by both connection flows. */
type FacebookSdk = {
  init(options: {
    appId: string
    autoLogAppEvents: boolean
    xfbml: boolean
    version: string
  }): void
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: ReturnType<typeof facebookLoginOptions> & {
      extras?: { setup: object }
    }
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

function connectedPagesToast(result: ConnectedPageAccounts) {
  toast.add({
    type: "success",
    title: "Facebook Page & Instagram connected",
    description: result.accounts
      .map(
        (account) =>
          `${CHANNEL_LABELS[account.channel]}: ${channelHandle(account.channel, account.handle)}`
      )
      .join(", "),
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
  onManualPage,
}: {
  onManualPage: () => void
  config:
    | {
        configured: boolean
        appId?: string
        configIds: { whatsapp?: string; facebookLogin?: string }
        graphVersion: string
      }
    | undefined
  onConnected: (result: ConnectedBusiness) => void
}) {
  const { canWrite, exchangeSignup, connectFacebookLogin } =
    useChannelCommands()
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

  function startFacebookLogin() {
    const sdk = window.FB
    const facebookConfig = config?.configIds.facebookLogin
    if (!sdk || !facebookConfig || pending) return
    setPending(true)
    try {
      sdk.login((response) => {
        const code = response.authResponse?.code
        if (!code) {
          setPending(false)
          return
        }
        void connectFacebookLogin(code)
          .then(connectedPagesToast)
          .catch((error) => {
            toast.add({
              type: "error",
              title: "Could not connect Facebook Page & Instagram",
              description: actionError(error),
            })
          })
          .finally(() => setPending(false))
      }, facebookLoginOptions(facebookConfig))
    } catch (error) {
      setPending(false)
      toast.add({ type: "error", title: actionError(error) })
    }
  }

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
      <ButtonGroup aria-label="Connect a channel">
        <Button
          disabled={!canWrite || !configId || !sdkReady || pending}
          onClick={start}
        >
          <PlusIcon />
          {pending ? "Connecting…" : "Connect with Meta"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Connect channel"
                disabled={!canWrite || pending}
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!configId || !sdkReady}
                onClick={start}
              >
                <WhatsAppIcon />
                WhatsApp
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!config?.configIds.facebookLogin || !sdkReady}
                onClick={startFacebookLogin}
              >
                <MessengerIcon />
                Facebook Page & Instagram
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!config?.configured}
                onClick={onManualPage}
              >
                <MessengerIcon />
                Connect Page manually
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </>
  )
}

/** Connects a WhatsApp Business Account with a system-user access token,
    for teams that cannot use Embedded Signup. */
export function ManualConnectDialog({
  open,
  onOpenChange,
  onConnected,
  mode = "whatsapp",
}: {
  mode?: "whatsapp" | "page"
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (result: ConnectedBusiness) => void
}) {
  const { connectManual, connectPageManual } = useChannelCommands()
  const page = mode === "page"
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
      if (page) {
        connectedPagesToast(
          await connectPageManual({
            pageId: wabaId.trim(),
            token: token.trim(),
          })
        )
      } else {
        const result = await connectManual({ wabaId, token })
        connectedToast(result)
        onConnected(result)
      }
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
            <DialogTitle>
              {page ? "Connect Page manually" : "Connect manually"}
            </DialogTitle>
            <DialogDescription>
              {page
                ? "Connect a Facebook Page and its linked Instagram professional account with a Page or system-user access token."
                : "Connect a WhatsApp Business Account with an access token from a system user in Meta Business Suite."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="channel-waba">
                {page ? "Page ID" : "WhatsApp Business Account ID"}
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
                {page ? "Page access token" : "System user access token"}
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
                  {page
                    ? "Use a token with pages_messaging and instagram_business_manage_messages permissions."
                    : "Give the system user the whatsapp_business_management and whatsapp_business_messaging permissions."}{" "}
                  <a
                    href={
                      page
                        ? "https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/"
                        : TOKEN_DOCS
                    }
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
