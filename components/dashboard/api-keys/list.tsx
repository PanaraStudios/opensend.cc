"use client"

import * as React from "react"
import Link from "next/link"
import { EyeIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ApiKeyFormDialog,
  ApiKeyIcon,
  ApiKeyToken,
  ApiKeysDocsSheet,
  DeleteApiKeyDialog,
  PERMISSION_FILTER_ITEMS,
  ViewApiKeyDialog,
} from "@/components/dashboard/api-keys/shared"
import {
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  MoreMenu,
  PageHeader,
  RelativeTime,
  ResourceTable,
  Th,
  useDebouncedValue,
  usePaginatedRows,
} from "@/components/dashboard/primitives"
import { Skeleton } from "@/components/ui/skeleton"
import { usePaginatedQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { asApiKey, useApiKeyCommands } from "@/lib/api-keys/use-api-keys"
import { ALL_PERMISSIONS } from "@/lib/dashboard/api-keys"
import { permissionLabel } from "@/lib/dashboard/format"
import { useStartExport } from "@/lib/exports/use-exports"
import type { ApiKey, ApiKeyPermission } from "@/lib/dashboard/types"

export function ApiKeysView() {
  const { organizationId, createApiKey, updateApiKey, deleteApiKey } =
    useApiKeyCommands()
  const startExport = useStartExport()
  const [query, setQuery] = React.useState("")
  const [permission, setPermission] = React.useState(ALL_PERMISSIONS)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<ApiKey | null>(null)
  const [deleting, setDeleting] = React.useState<ApiKey | null>(null)
  const [token, setToken] = React.useState<string | null>(null)

  const search = useDebouncedValue(query)
  const filters = {
    search: search.trim() || undefined,
    permission:
      permission === ALL_PERMISSIONS
        ? undefined
        : (permission as ApiKeyPermission),
  }
  const {
    results,
    status: loading,
    loadMore,
  } = usePaginatedQuery(
    api.apiKeys.list,
    organizationId ? { organizationId, ...filters } : "skip",
    { initialNumItems: 40 }
  )
  const rows = React.useMemo(() => results.map(asApiKey), [results])
  const { pageRows, pagination } = usePaginatedRows(rows, loading, loadMore)
  const unfiltered = !query && permission === ALL_PERMISSIONS

  return (
    <>
      <PageHeader title="API keys">
        <DocsButton onClick={() => setDocsOpen(true)} />
        <Button onClick={() => setAdding(true)}>
          <PlusIcon data-icon="inline-start" />
          Create API key
        </Button>
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search API keys…"
        filters={[
          {
            value: permission,
            onChange: setPermission,
            items: PERMISSION_FILTER_ITEMS,
            "aria-label": "Filter by permission",
          },
        ]}
        onExport={() => void startExport("api-keys", filters)}
      />
      {loading === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ApiKeyIcon}
          title={unfiltered ? "No API keys" : "No API keys found"}
          description={
            unfiltered
              ? "Create a key to send through the REST API or SMTP."
              : "No keys match these filters."
          }
        >
          {unfiltered ? (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Create API key
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Token</Th>
                <Th>Permission</Th>
                <Th>Last used</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((apiKey) => (
              <TableRow key={apiKey.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="icon-tile size-8 rounded-lg [&_svg]:size-4">
                      <ApiKeyIcon />
                    </span>
                    <Link
                      href={`/api-keys/${apiKey.id}`}
                      className="font-medium hover:underline"
                    >
                      {apiKey.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <ApiKeyToken apiKey={apiKey} />
                </TableCell>
                <TableCell>{permissionLabel(apiKey.permission)}</TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={apiKey.lastUsedAt} fallback="Never" />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={apiKey.createdAt} />
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={`/api-keys/${apiKey.id}`} />}
                      >
                        <EyeIcon />
                        View API key
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditing(apiKey)}>
                        <PencilIcon />
                        Edit API key
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleting(apiKey)}
                      >
                        <Trash2Icon />
                        Remove API key
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="key" />
        </>
      )}
      <ApiKeyFormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add API Key"
        submitLabel="Add"
        onSubmit={async (values) => {
          const created = await createApiKey(values)
          setToken(created.token)
          toast.add({ type: "success", title: "API key created" })
        }}
      />
      <ApiKeyFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        title="Edit API Key"
        submitLabel="Save"
        apiKey={editing}
        onSubmit={async (values) => {
          if (editing) await updateApiKey(editing.id, values)
          toast.add({ type: "success", title: "API key updated" })
        }}
      />
      <ViewApiKeyDialog
        token={token}
        onOpenChange={(next) => {
          if (!next) setToken(null)
        }}
      />
      <DeleteApiKeyDialog
        apiKey={deleting}
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        onConfirm={async () => {
          if (deleting) await deleteApiKey(deleting.id)
          toast.add({ type: "success", title: "API key removed" })
        }}
      />
      <ApiKeysDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
