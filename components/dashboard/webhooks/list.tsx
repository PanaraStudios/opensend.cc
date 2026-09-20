"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  DocsButton,
  EmptyState,
  IconCell,
  ListToolbar,
  MonoLink,
  PageHeader,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  WEBHOOK_STATUS_ITEMS,
  WebhookFormDialog,
  WebhookIcon,
  WebhookMenu,
  WebhooksDocsSheet,
  WebhookStatusBadge,
} from "@/components/dashboard/webhooks/shared"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import { webhookEventsLabel } from "@/lib/dashboard/webhooks"

export function WebhooksView() {
  const router = useRouter()
  const { state, createWebhook } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [adding, setAdding] = React.useState(false)

  const needle = searchNeedle(query)
  const rows = state.webhooks.filter(
    (item) =>
      matchesNeedle(needle, item.endpoint, ...item.events) &&
      (status === "all" || item.enabled === (status === "enabled"))
  )

  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon data-icon="inline-start" />
      Add webhook
    </Button>
  )

  return (
    <>
      <PageHeader title="Webhooks">
        <DocsButton onClick={() => setDocsOpen(true)} />
        {addButton}
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search endpoints…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: WEBHOOK_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      />
      {state.webhooks.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks yet"
          description="Add an endpoint to get real-time events pushed to your server."
        >
          {addButton}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks found"
          description="Nothing matches this search and status."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Endpoint</Th>
              <Th>Status</Th>
              <Th>Listening for</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <IconCell icon={WebhookIcon}>
                  <MonoLink href={`/webhooks/${item.id}`}>
                    {item.endpoint}
                  </MonoLink>
                </IconCell>
              </TableCell>
              <TableCell>
                <WebhookStatusBadge enabled={item.enabled} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {webhookEventsLabel(item.events)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                <RelativeTime at={item.createdAt} />
              </TableCell>
              <TableCell>
                <WebhookMenu webhook={item} />
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <WebhookFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSubmit={(values) => {
          const created = createWebhook(values)
          toast.add({ type: "success", title: "Webhook added" })
          router.push(`/webhooks/${created.id}`)
        }}
      />
      <WebhooksDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
