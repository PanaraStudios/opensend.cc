"use client"
import * as React from "react"
import { useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  useConfirmShortcut,
  useShortcutModifier,
} from "@/lib/dashboard/use-shortcut"
import { actionError } from "@/lib/action-error"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"

/** Moves the installation to a new public URL. The URL has to reach this
    deployment; AWS then subscribes it and every domain refreshes, which the
    Sending regions card shows as it happens. */
export function ChangePublicUrlDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted per opening, so each change starts empty. */}
      {open ? <ChangePublicUrlForm onOpenChange={onOpenChange} /> : null}
    </Dialog>
  )
}

function ChangePublicUrlForm({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const change = useAction(api.installationActions.changeCallbackOrigin)
  const { scope, button } = useConfirmShortcut(true)
  const modifier = useShortcutModifier()
  const [url, setUrl] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !url.trim()) return
    setPending(true)
    setError("")
    try {
      await change({ callbackOrigin: url.trim() })
      onOpenChange(false)
      toast.add({
        type: "success",
        title: "Public URL changed",
        description:
          "Sending resumes in each region once AWS confirms the new URL.",
      })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg" ref={scope}>
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Change public URL</DialogTitle>
          <DialogDescription>
            Use a new HTTPS address for this backend. Opensend first checks
            that it reaches this deployment.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="public-url">New public URL</FieldLabel>
            <Input
              id="public-url"
              type="url"
              value={url}
              placeholder="https://api.example.com"
              autoComplete="off"
              autoFocus
              disabled={pending}
              onChange={(event) => {
                setUrl(event.target.value)
                setError("")
              }}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <ul className="ml-4 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
              <li>
                AWS sends delivery events and inbound mail to the new URL.
                Sending pauses in each region until AWS confirms it.
              </li>
              <li>
                Tracking and unsubscribe links in new emails use the new URL.
              </li>
              <li>
                Domains refresh. A domain with a tracking subdomain gets a new
                CNAME target to update at its DNS provider.
              </li>
              <li>
                The previous endpoint&apos;s subscription stays in Amazon SNS;
                you can delete it in the SNS console.
              </li>
          </ul>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
            <Kbd>Esc</Kbd>
          </DialogClose>
          <Button
            type="submit"
            ref={button}
            disabled={pending || !url.trim()}
            aria-keyshortcuts={
              modifier === "⌘" ? "Meta+Enter" : "Control+Enter"
            }
          >
            {pending ? "Checking…" : "Change URL"}
            <Kbd aria-hidden="true">{modifier} Enter</Kbd>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
