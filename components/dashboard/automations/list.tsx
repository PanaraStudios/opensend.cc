"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  AutomationStatusBadge,
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  ListToolbar,
  RelativeTime,
  ResourceTable,
  Th,
  useTeamList,
  useListSearch,
} from "@/components/dashboard/primitives"
import {
  AUTOMATION_STATUS_ITEMS,
  AutomationIcon,
  AutomationMenu,
  AutomationsChrome,
} from "@/components/dashboard/automations/shared"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import {
  asListedAutomation,
  useAutomationCommands,
} from "@/lib/automations/use-automations"

export function AutomationsView() {
  const router = useRouter()
  const { organizationId, addAutomation } = useAutomationCommands()
  const { query, setQuery, search } = useListSearch()
  const [status, setStatus] = React.useState("all")

  const {
    rows,
    pageRows,
    pagination,
    status: loading,
  } = useTeamList(
    api.automations.list,
    api.automations.count,
    {
      search,
      ...(status === "all" ? {} : { status: status as "enabled" | "disabled" }),
    },
    asListedAutomation
  )
  const total = useQuery(
    api.automations.count,
    organizationId ? { organizationId } : "skip"
  )

  const createButton = (
    /* No form: a new automation is blank, and is set up in the editor. */
    <Button
      data-testid="automation-create"
      onClick={() => {
        void addAutomation()
          .then((item) => router.push(`/automations/${item.id}`))
          .catch((error) =>
            toast.add({ type: "error", title: actionError(error) })
          )
      }}
    >
      <PlusIcon data-icon="inline-start" />
      Create automation
    </Button>
  )

  return (
    <>
      <AutomationsChrome
        actions={
          <>
            <DocsButton />
            {createButton}
          </>
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search automations…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: AUTOMATION_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      />
      {loading === "LoadingFirstPage" ? (
        <Skeleton className="h-64 w-full" />
      ) : total?.total === 0 ? (
        <EmptyState
          icon={AutomationIcon}
          title="No automations yet"
          description="Automate your email sending with triggers, delays, and conditions."
        >
          {createButton}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AutomationIcon}
          title="No automations found"
          description="Nothing matches this search and status."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Runs</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <IconCell icon={AutomationIcon}>
                    <Link
                      href={`/automations/${item.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                  </IconCell>
                </TableCell>
                <TableCell>
                  <AutomationStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.runs}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={item.createdAt} />
                </TableCell>
                <TableCell>
                  <AutomationMenu automation={item} />
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="automation" />
        </>
      )}
    </>
  )
}
