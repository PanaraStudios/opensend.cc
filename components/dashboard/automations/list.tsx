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
  ListToolbar,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  AUTOMATION_STATUS_ITEMS,
  AutomationIcon,
  AutomationMenu,
  AutomationsChrome,
  AutomationsDocsSheet,
} from "@/components/dashboard/automations/shared"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"

export function AutomationsView() {
  const router = useRouter()
  const { state, addAutomation } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [docsOpen, setDocsOpen] = React.useState(false)

  /* Counted once, not once per row per keystroke of the search. */
  const runCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const run of state.automationRuns) {
      counts.set(run.automationId, (counts.get(run.automationId) ?? 0) + 1)
    }
    return counts
  }, [state.automationRuns])

  const needle = searchNeedle(query)
  const rows = state.automations.filter(
    (item) =>
      matchesNeedle(needle, item.name, item.trigger) &&
      (status === "all" || item.status === status)
  )

  const createButton = (
    /* No form: a new automation is blank, and is set up in the editor. */
    <Button
      data-testid="automation-create"
      onClick={() => router.push(`/automations/${addAutomation().id}`)}
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
            <DocsButton onClick={() => setDocsOpen(true)} />
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
      {state.automations.length === 0 ? (
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
          {rows.map((item) => (
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
                {runCounts.get(item.id) ?? 0}
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
      )}
      <AutomationsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
