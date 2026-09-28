"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { useQuery } from "convex/react"
import { PencilIcon, Trash2Icon } from "lucide-react"

import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  ApiKeyFormDialog,
  ApiKeyIcon,
  ApiKeyToken,
  ApiKeysDocsSheet,
  DeleteApiKeyDialog,
} from "@/components/dashboard/api-keys/shared"
import {
  LOG_TABLE_HEADERS,
  LogIcon,
  LogRow,
} from "@/components/dashboard/logs/shared"
import {
  DetailHeader,
  DocsButton,
  EmptyState,
  ListPagination,
  MetaStrip,
  MoreMenu,
  NotFoundState,
  RelativeTime,
  ResourceTable,
  useDeleteRecord,
  useTeamList,
} from "@/components/dashboard/primitives"
import { api } from "@/convex/_generated/api"
import { asApiKey, useApiKeyCommands } from "@/lib/api-keys/use-api-keys"
import { apiKeyDomainLabel } from "@/lib/dashboard/api-keys"
import { permissionLabel, pluralize } from "@/lib/dashboard/format"
import { useDomain } from "@/lib/domains/use-domains"
import { asLog } from "@/lib/logs/use-logs"

export function ApiKeyDetail() {
  const { id } = useParams<{ id: string }>()
  const { updateApiKey, deleteApiKey } = useApiKeyCommands()
  const { leaving, deleteAndLeave } = useDeleteRecord("/api-keys")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const found = useQuery(api.apiKeys.get, { id })
  const domain = useDomain(found?.key.domainId)
  const recent = useTeamList(
    api.logs.list,
    api.logs.count,
    found ? { apiKeyId: found.key._id } : "skip",
    asLog
  )

  if (found === undefined) return <Skeleton className="h-64 w-full" />
  if (!found) {
    if (leaving) return null
    return (
      <NotFoundState
        icon={ApiKeyIcon}
        noun="API key"
        backHref="/api-keys"
        backLabel="Back to API keys"
      />
    )
  }

  const apiKey = asApiKey(found.key)

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/api-keys"
        backLabel="API keys"
        title={apiKey.name}
        icon={ApiKeyIcon}
        actions={
          <>
            <DocsButton onClick={() => setDocsOpen(true)} />
            <MoreMenu>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit API key
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2Icon />
                  Remove API key
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />
      <MetaStrip
        items={[
          { label: "Permission", value: permissionLabel(apiKey.permission) },
          {
            label: "Domain",
            value: apiKeyDomainLabel(domain ? [domain] : [], apiKey),
          },
          {
            label: "Total uses",
            value: pluralize(found.requests, "request"),
          },
          { label: "Token", value: <ApiKeyToken apiKey={apiKey} /> },
          {
            label: "Last used",
            value: <RelativeTime at={apiKey.lastUsedAt} fallback="Never" />,
          },
          { label: "Created", value: <RelativeTime at={apiKey.createdAt} /> },
          { label: "Creator", value: apiKey.createdBy ?? "—" },
        ]}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Recent requests</h2>
        {recent.status === "LoadingFirstPage" ? (
          <Skeleton className="h-40 w-full" />
        ) : recent.rows.length === 0 ? (
          <EmptyState
            icon={LogIcon}
            title="No requests yet"
            description="Requests signed with this key show up here."
          />
        ) : (
          <>
            <ResourceTable headers={LOG_TABLE_HEADERS}>
              {recent.pageRows.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </ResourceTable>
            <ListPagination
              {...recent.pagination}
              noun="request"
              previousLabel="Newer"
              nextLabel="Older"
            />
          </>
        )}
      </section>
      <ApiKeyFormDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit API Key"
        submitLabel="Save"
        apiKey={apiKey}
        onSubmit={async (values) => {
          await updateApiKey(apiKey.id, values)
          toast.add({ type: "success", title: "API key updated" })
        }}
      />
      <DeleteApiKeyDialog
        apiKey={apiKey}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() =>
          deleteAndLeave(async () => {
            await deleteApiKey(apiKey.id)
            toast.add({ type: "success", title: "API key removed" })
          })
        }
      />
      <ApiKeysDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
