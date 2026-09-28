"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  ListToolbar,
  MonoLink,
  PageHeader,
  RelativeTime,
  ResourceTable,
  Th,
  useDebouncedValue,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  WEBHOOK_STATUS_ITEMS,
  WebhookFormDialog,
  WebhookIcon,
  WebhookMenu,
  WebhooksDocsSheet,
  WebhookStatusBadge,
} from "@/components/dashboard/webhooks/shared"
import { api } from "@/convex/_generated/api"
import { webhookEventsLabel } from "@/lib/dashboard/webhooks"
import { asWebhook, useWebhookCommands } from "@/lib/webhooks/use-webhooks"

export function WebhooksView() {
  const router = useRouter()
  const { organizationId, createWebhook } = useWebhookCommands()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const webhooks = useTeamList(
    api.webhooks.list,
    api.webhooks.count,
    {
      search: useDebouncedValue(query),
      ...(status !== "all" ? { enabled: status === "enabled" } : {}),
    },
    asWebhook
  )
  const { rows, pageRows, pagination } = webhooks
  const hasAny = useQuery(
    api.webhooks.hasAny,
    organizationId ? { organizationId } : "skip"
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
      {webhooks.status === "LoadingFirstPage" || hasAny === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : !hasAny ? (
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
        <>
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
            {pageRows.map((item) => (
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
          <ListPagination {...pagination} noun="webhook" />
        </>
      )}
      <WebhookFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSubmit={async (values) => {
          const id = await createWebhook(values)
          toast.add({ type: "success", title: "Webhook added" })
          router.push(`/webhooks/${id}`)
        }}
      />
      <WebhooksDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
