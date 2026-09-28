"use client"

import * as React from "react"

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
import { actionError } from "@/lib/action-error"
import type { ExportFilterLine } from "@/lib/dashboard/exports"
import { useStartExport } from "@/lib/exports/use-exports"

/** Each confirmed filter as "Label: value". The export dialog and the
    export's page show the same lines. */
export function ExportFilterList({
  lines,
}: {
  lines: readonly ExportFilterLine[]
}) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {lines.map((line) => (
        <li key={line.label} className="break-words">
          <span className="text-muted-foreground">{line.label}:</span>{" "}
          {line.value}
        </li>
      ))}
    </ul>
  )
}

function ExportDialogForm({
  noun,
  summary,
  onOpenChange,
  onConfirm,
}: {
  noun: string
  summary: readonly ExportFilterLine[]
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<unknown>
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (pending) return
          setPending(true)
          setError("")
          try {
            await onConfirm()
            onOpenChange(false)
          } catch (e) {
            setError(actionError(e))
          } finally {
            setPending(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Export {noun}</DialogTitle>
          <DialogDescription>
            Confirm the filters you want to apply before exporting.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <ExportFilterList lines={summary} />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={pending}>
            Export
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** Resend's export flow for a list: its toolbar's export button opens a
    dialog that confirms the filters, then the export starts on the server.
    `filters` are what the list's export source reads; `extra` lines confirm
    filters the toolbar does not show. Pass `open` as the toolbar's
    `onExport` and render `dialog`. */
export function useExportDialog({
  resource,
  noun,
  filters,
  extra = [],
  onConfirm,
}: {
  resource: string
  /** Lower-case plural, for the title: "Export API keys". */
  noun: string
  filters: Record<string, string | number | boolean | undefined>
  extra?: readonly ExportFilterLine[]
  onConfirm?: () => void
}) {
  const start = useStartExport()
  const [confirmed, setConfirmed] = React.useState<{
    summary: ExportFilterLine[]
    filters: typeof filters
  } | null>(null)
  const onOpenChange = (open: boolean) => {
    if (!open) setConfirmed(null)
  }
  return {
    open: (lines: ExportFilterLine[]) =>
      setConfirmed({ summary: [...lines, ...extra], filters: { ...filters } }),
    dialog: (
      <Dialog open={confirmed !== null} onOpenChange={onOpenChange}>
        {/* Mounted per opening, so no error or pending state carries over. */}
        {confirmed ? (
          <ExportDialogForm
            noun={noun}
            summary={confirmed.summary}
            onOpenChange={onOpenChange}
            onConfirm={async () =>
              onConfirm
                ? onConfirm()
                : start(resource, confirmed.filters, confirmed.summary)
            }
          />
        ) : null}
      </Dialog>
    ),
  }
}
