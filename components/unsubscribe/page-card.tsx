"use client"

import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Surface } from "@/components/dashboard/primitives"
import type { UnsubscribePage } from "@/lib/unsubscribe/page"

/** A recipient's own choices, when the page is live rather than a preview. */
type Live = {
  subscribed: boolean
  disabled: boolean
  onSubscribed: (subscribed: boolean) => void
  onTopic: (topicId: string, subscribed: boolean) => void
}

/** The unsubscribe page: the Settings preview, and made live the page a
    recipient's link opens, so the two always look the same. */
export function UnsubscribePageCard({
  page,
  topics,
  live,
}: {
  page: UnsubscribePage
  /** Public topics only. */
  topics: { id: string; name: string; subscribed?: boolean }[]
  live?: Live
}) {
  return (
    <Surface>
      {live ? null : (
        <p className="font-mono text-caption text-muted-foreground">Preview</p>
      )}
      <p className="text-small text-muted-foreground">{page.brandName}</p>
      <h2 className="text-h4">{page.heading}</h2>
      <p className="text-small text-muted-foreground">{page.body}</p>
      <ul className="space-y-2 text-sm">
        {topics.map((topic) => (
          <li key={topic.id} className="flex items-center justify-between">
            <span>{topic.name}</span>
            {live ? (
              <Switch
                aria-label={topic.name}
                // Unsubscribing from everything overrides every topic.
                checked={live.subscribed && !!topic.subscribed}
                disabled={live.disabled || !live.subscribed}
                onCheckedChange={(checked) => live.onTopic(topic.id, checked)}
              />
            ) : (
              <Badge variant="secondary">Topic</Badge>
            )}
          </li>
        ))}
        {live ? (
          <li className="flex items-center justify-between">
            <label htmlFor="unsubscribe-all">Subscribed</label>
            <Switch
              id="unsubscribe-all"
              checked={live.subscribed}
              disabled={live.disabled}
              onCheckedChange={live.onSubscribed}
            />
          </li>
        ) : null}
      </ul>
    </Surface>
  )
}
