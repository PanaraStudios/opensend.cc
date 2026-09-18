"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { MegaphoneIcon } from "lucide-react"

import { BroadcastStatusBadge } from "@/components/dashboard/primitives"
import { BroadcastSendFields } from "@/components/dashboard/broadcasts/editor/header-form"
import { ReviewPopover } from "@/components/dashboard/broadcasts/editor/review"
import {
  EditorNotFound,
  EmailEditorScreen,
} from "@/components/dashboard/broadcasts/editor/screen"
import { isBroadcastDraftLike } from "@/lib/dashboard/broadcast"
import { useDashboard, useStoreHydrated } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

export function BroadcastEditor() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state } = useDashboard()
  const hydrated = useStoreHydrated()
  const item = state.broadcasts.find((row) => row.id === id)
  const report = Boolean(item) && !isBroadcastDraftLike(item!.status)

  React.useEffect(() => {
    if (report) router.replace(`/broadcasts/${id}`)
  }, [id, report, router])

  /* The editor copies the document into the engine when it mounts, so it
     waits for the saved one rather than starting from the seed. */
  if (!hydrated) return null

  if (!item) {
    return (
      <EditorNotFound
        icon={MegaphoneIcon}
        noun="broadcast"
        backHref="/broadcasts"
      />
    )
  }
  if (report) return null

  return <BroadcastScreen key={item.id} item={item} />
}

function BroadcastScreen({ item }: { item: Broadcast }) {
  const { updateBroadcast } = useDashboard()
  /* Kept out here: a chosen send time is not saved until the send, and the
     editor remounting on a new theme preset must not quietly turn a scheduled
     send into an immediate one. */
  const [sendAt, setSendAt] = React.useState<number | null>(item.scheduledAt)
  return (
    <EmailEditorScreen
      item={item}
      noun="broadcast"
      listHref="/broadcasts"
      listLabel="Broadcasts"
      badge={<BroadcastStatusBadge status={item.status} />}
      onChange={(patch) => updateBroadcast(item.id, patch)}
      headerExtra={
        <BroadcastSendFields
          item={item}
          sendAt={sendAt}
          onSendAtChange={setSendAt}
        />
      }
      actions={(editor) => (
        <ReviewPopover
          item={item}
          html={editor.html}
          empty={editor.empty}
          sendAt={sendAt}
          flush={editor.flush}
        />
      )}
    />
  )
}
