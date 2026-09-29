"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileCodeIcon, LayoutGridIcon, PlusIcon, Rows3Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SegmentedToggle } from "@/components/ui/segmented-toggle"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  MonoValue,
  PageHeader,
  RelativeTime,
  ResourceTable,
  TemplateStatusBadge,
  Th,
  useDebouncedValue,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  TEMPLATE_STATUS_ITEMS,
  TemplateMenu,
  TemplateThumbnail,
} from "@/components/dashboard/templates/shared"
import { api } from "@/convex/_generated/api"
import { actionError } from "@/lib/action-error"
import { UNTITLED_TEMPLATE } from "@/lib/dashboard/template"
import type { EmailTemplate, TemplateStatus } from "@/lib/dashboard/types"
import { asTemplate, useTemplateCommands } from "@/lib/templates/use-templates"

type TemplatesLayout = "grid" | "table"

/** List rows carry their draft markup for the thumbnails. */
const asListedTemplate = (
  row: FunctionReturnType<typeof api.templates.list>["page"][number]
) => asTemplate(row, row)

const LAYOUT_ITEMS = [
  { value: "grid" as const, label: "Grid view", icon: LayoutGridIcon },
  { value: "table" as const, label: "Table view", icon: Rows3Icon },
]

function TemplateCard({ item }: { item: EmailTemplate }) {
  return (
    <li
      data-testid="template-card"
      className="group relative flex min-w-0 flex-col gap-3 rounded-xl outline-none focus-within:ring-2 focus-within:ring-ring/50"
    >
      <TemplateThumbnail item={item} />
      <div className="flex items-start gap-2 px-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Stretched over the card, so all of it opens the template. */}
          <Link
            href={`/templates/${item.id}`}
            className="truncate text-sm font-medium outline-none group-hover:underline after:absolute after:inset-0"
          >
            {item.name}
          </Link>
          <span className="truncate font-mono text-[13px] text-muted-foreground">
            {item.alias}
          </span>
        </div>
        <TemplateStatusBadge status={item.status} />
        <div className="relative">
          <TemplateMenu item={item} />
        </div>
      </div>
    </li>
  )
}

export function TemplatesView() {
  const router = useRouter()
  const { organizationId, addTemplate } = useTemplateCommands()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [layout, setLayout] = React.useState<TemplatesLayout>("grid")
  const creating = React.useRef(false)
  const search = useDebouncedValue(query)

  const {
    rows,
    status: loading,
    pageRows,
    pagination,
  } = useTeamList(
    api.templates.list,
    api.templates.count,
    {
      search,
      ...(status !== "all" ? { status: status as TemplateStatus } : {}),
    },
    asListedTemplate
  )
  const hasTemplates = useQuery(
    api.templates.hasAny,
    organizationId ? { organizationId } : "skip"
  )

  async function createTemplate() {
    if (creating.current) return
    creating.current = true
    try {
      const id = await addTemplate({ name: UNTITLED_TEMPLATE, subject: "" })
      toast.add({ type: "success", title: "Draft created" })
      router.push(`/templates/${id}`)
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      creating.current = false
    }
  }

  const createButton = (
    <Button onClick={createTemplate}>
      <PlusIcon data-icon="inline-start" />
      Create template
    </Button>
  )

  return (
    <>
      <PageHeader title="Templates">
        <DocsButton />
        {createButton}
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search templates…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: TEMPLATE_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      >
        <SegmentedToggle
          value={layout}
          onValueChange={setLayout}
          items={LAYOUT_ITEMS}
          aria-label="Layout"
          testIdPrefix="templates-layout"
          className="ml-auto w-auto"
        />
      </ListToolbar>
      {loading === "LoadingFirstPage" || hasTemplates === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : !hasTemplates ? (
        <EmptyState
          icon={FileCodeIcon}
          title="No templates yet"
          description="Create a new template to reuse in your emails."
        >
          {createButton}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileCodeIcon}
          title="No templates found"
          description="Nothing matches this search and status."
        />
      ) : (
        <>
          {layout === "grid" ? (
            <ul
              data-testid="templates-grid"
              className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-x-6 gap-y-8"
            >
              {pageRows.map((item) => (
                <TemplateCard key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <ResourceTable
              headers={
                <>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Alias</Th>
                  <Th>Updated</Th>
                  <Th className="w-10" />
                </>
              }
            >
              {pageRows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      href={`/templates/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TemplateStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <MonoValue copyValue={item.alias}>{item.alias}</MonoValue>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime at={item.updatedAt} />
                  </TableCell>
                  <TableCell>
                    <TemplateMenu item={item} />
                  </TableCell>
                </TableRow>
              ))}
            </ResourceTable>
          )}
          <ListPagination {...pagination} noun="template" />
        </>
      )}
    </>
  )
}
