"use client"
import { useAction, useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import type {
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "@/lib/dashboard/types"

type WebhookRow = FunctionReturnType<typeof api.webhooks.list>["page"][number]

/** The secret is left out: only the webhook page reads it, on its own. */
export function asWebhook(row: WebhookRow, signingSecret = ""): Webhook {
  return {
    id: row._id,
    endpoint: row.endpoint,
    events: row.events as WebhookEvent[],
    enabled: row.enabled,
    signingSecret,
    createdAt: row._creationTime,
  }
}

export function asWebhookDelivery(
  row: Doc<"webhookDeliveries">
): WebhookDelivery {
  return {
    id: row._id,
    webhookId: row.webhookId,
    event: row.event as WebhookEvent,
    status: row.status,
    attempts: row.attempts,
    durationMs: row.durationMs,
    createdAt: row._creationTime,
    payload: row.payload,
    response: row.response,
  }
}

export function useWebhookCommands() {
  const { activeTeamId } = useWorkspace()
  const create = useAction(api.webhooks.create)
  const update = useMutation(api.webhooks.update)
  const remove = useMutation(api.webhooks.remove)
  const rotate = useAction(api.webhooks.rotateSecret)
  const replay = useMutation(api.webhooks.replay)
  return {
    organizationId: activeTeamId,
    createWebhook: (input: Pick<Webhook, "endpoint" | "events">) => {
      if (!activeTeamId) throw new Error("Create a team first")
      return create({ ...input, organizationId: activeTeamId })
    },
    updateWebhook: (
      id: string,
      patch: Partial<Pick<Webhook, "endpoint" | "events" | "enabled">>
    ) => update({ id: id as Id<"webhooks">, ...patch }),
    deleteWebhook: (id: string) => remove({ id: id as Id<"webhooks"> }),
    rotateWebhookSecret: (id: string) => rotate({ id: id as Id<"webhooks"> }),
    replayWebhookDelivery: (id: string) =>
      replay({ id: id as Id<"webhookDeliveries"> }),
  }
}
