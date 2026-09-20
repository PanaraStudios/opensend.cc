"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { PencilIcon, Trash2Icon } from "lucide-react"

import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
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
  MetaStrip,
  MoreMenu,
  NotFoundState,
  RelativeTime,
  ResourceTable,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import { apiKeyDomainLabel, apiKeyLogs } from "@/lib/dashboard/api-keys"
import { permissionLabel, pluralize } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

/** Requests shown inline. The full history stays on the logs page. */
const RECENT_REQUESTS = 10

export function ApiKeyDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, updateApiKey, deleteApiKey } = useDashboard()
  const { leaving, deleteAndLeave } = useDeleteRecord("/api-keys")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const apiKey = state.apiKeys.find((item) => item.id === id)

  if (!apiKey) {
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

  const logs = apiKeyLogs(state.logs, apiKey.id)
  const creator = state.members.find((member) => member.id === apiKey.createdBy)

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
            value: apiKeyDomainLabel(state.domains, apiKey),
          },
          { label: "Total uses", value: pluralize(logs.length, "request") },
          { label: "Token", value: <ApiKeyToken apiKey={apiKey} /> },
          {
            label: "Last used",
            value: <RelativeTime at={apiKey.lastUsedAt} fallback="Never" />,
          },
          { label: "Created", value: <RelativeTime at={apiKey.createdAt} /> },
          { label: "Creator", value: creator?.name ?? "—" },
        ]}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Recent requests</h2>
        {logs.length === 0 ? (
          <EmptyState
            icon={LogIcon}
            title="No requests yet"
            description="Requests signed with this key show up here."
          />
        ) : (
          <ResourceTable headers={LOG_TABLE_HEADERS}>
            {logs.slice(0, RECENT_REQUESTS).map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </ResourceTable>
        )}
      </section>
      <ApiKeyFormDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit API Key"
        submitLabel="Save"
        apiKey={apiKey}
        onSubmit={(values) => {
          updateApiKey(apiKey.id, values)
          toast.add({ type: "success", title: "API key updated" })
        }}
      />
      <DeleteApiKeyDialog
        apiKey={apiKey}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() =>
          deleteAndLeave(() => {
            deleteApiKey(apiKey.id)
            toast.add({ type: "success", title: "API key removed" })
          })
        }
      />
      <ApiKeysDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
