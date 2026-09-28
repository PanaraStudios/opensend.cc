"use client"

import * as React from "react"
import { notFound } from "next/navigation"
import { useMutation, useQuery } from "convex/react"

import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster, toast } from "@/components/ui/toast"
import { UnsubscribePageCard } from "@/components/unsubscribe/page-card"
import { actionError } from "@/lib/action-error"

/** The page a recipient's unsubscribe link opens. Each switch saves at once. */
export function UnsubscribePreferences({ token }: { token: string }) {
  return (
    <Toaster>
      <Preferences token={token} />
    </Toaster>
  )
}

function Preferences({ token }: { token: string }) {
  const preferences = useQuery(api.unsubscribe.preferences, { token })
  const setTopic = useMutation(api.unsubscribe.setTopic)
  const setSubscribed = useMutation(api.unsubscribe.setSubscribed)
  const [pending, setPending] = React.useState(false)

  if (preferences === undefined) return <Skeleton className="h-40 w-full" />
  // The contact was deleted while the page was open.
  if (preferences === null) notFound()

  async function run(change: Promise<unknown>) {
    setPending(true)
    try {
      await change
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <UnsubscribePageCard
      page={preferences.page}
      topics={preferences.topics}
      live={{
        subscribed: !preferences.unsubscribed,
        disabled: pending,
        onSubscribed: (subscribed) => run(setSubscribed({ token, subscribed })),
        onTopic: (topicId, subscribed) =>
          run(setTopic({ token, topicId, subscribed })),
      }}
    />
  )
}
