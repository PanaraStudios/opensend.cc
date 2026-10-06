"use client"

import * as React from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldContent,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { SettingsCard } from "@/components/dashboard/primitives"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"

const telemetryDocs =
  "https://github.com/PanaraStudios/opensend.cc/blob/master/docs/telemetry.md"

/** Shared by setup and instance settings, with the same server-side precedence. */
export function TelemetrySettings({ setup = false }: { setup?: boolean }) {
  const settings = useQuery(api.telemetry.settings)
  const save = useMutation(api.telemetry.setEnabled)
  const preview = useAction(api.telemetry.preview)
  const [pending, setPending] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [json, setJson] = React.useState<string | null>(null)
  const id = React.useId()
  if (!settings) return <Skeleton className="h-28 w-full" />
  const content = (
    <div className="flex min-w-0 flex-col gap-3">
      <Field orientation="horizontal">
        <FieldContent className="min-w-0">
          <FieldLabel htmlFor={id}>Share anonymous usage statistics</FieldLabel>
          <FieldDescription id={`${id}-description`}>
            Shares a random installation ID, deployment details and feature
            usage in broad ranges once a day.
          </FieldDescription>
        </FieldContent>
        <Switch
          id={id}
          aria-describedby={`${id}-description`}
          checked={settings?.enabled ?? true}
          disabled={!settings || settings.locked || pending}
          onCheckedChange={async (enabled) => {
            setPending(true)
            try {
              await save({ enabled })
            } catch (error) {
              toast.add({ type: "error", title: actionError(error) })
            } finally {
              setPending(false)
            }
          }}
        />
      </Field>
      {settings?.locked && (
        <p className="text-sm text-muted-foreground">
          Disabled by the server environment. This switch is locked.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={telemetryDocs}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4"
        >
          Read about anonymous statistics
        </a>
        <Button
          variant="outline"
          disabled={pending || !settings}
          onClick={async () => {
            setOpen(true)
            setJson(null)
            setPending(true)
            try {
              setJson(JSON.stringify(await preview({}), null, 2))
            } catch (error) {
              setOpen(false)
              toast.add({ type: "error", title: actionError(error) })
            } finally {
              setPending(false)
            }
          }}
        >
          View what&apos;s sent
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="min-w-0 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Anonymous statistics payload</DialogTitle>
            <DialogDescription>
              The exact JSON built from current usage. The send time and usage
              refresh at the next ping.
              {settings?.enabled
                ? ""
                : " Sharing is off; this preview sends nothing."}
            </DialogDescription>
          </DialogHeader>
          {json ? (
            <pre className="max-h-[60svh] min-w-0 overflow-y-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
              {json}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              Building preview…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
  return setup ? (
    content
  ) : (
    <SettingsCard title="Anonymous usage statistics">{content}</SettingsCard>
  )
}
