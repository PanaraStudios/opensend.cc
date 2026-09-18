"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileCodeIcon, LayoutGridIcon, PlusIcon, Rows3Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SegmentedToggle } from "@/components/ui/segmented-toggle"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import {
  DocsButton,
  EmptyState,
  ListToolbar,
  MonoValue,
  PageHeader,
  RelativeTime,
  ResourceTable,
  TemplateStatusBadge,
  Th,
} from "@/components/dashboard/primitives"
import {
  TEMPLATE_STATUS_ITEMS,
  TemplateMenu,
  TemplatesDocsSheet,
} from "@/components/dashboard/templates/shared"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import { UNTITLED_TEMPLATE } from "@/lib/dashboard/template"
import type { EmailTemplate } from "@/lib/dashboard/types"

type TemplatesLayout = "grid" | "table"

const LAYOUT_ITEMS = [
  { value: "grid" as const, label: "Grid view", icon: LayoutGridIcon },
  { value: "table" as const, label: "Table view", icon: Rows3Icon },
]

/* The email itself, drawn small: a 600px sheet at half size, cut off by the
   card. It is a picture of the template, so it takes no clicks or focus. */
function TemplateThumbnail({ item }: { item: EmailTemplate }) {
  return (
    <div
      inert
      className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted"
    >
      <div className="absolute top-[18%] left-1/2 h-[200%] w-[600px] origin-top -translate-x-1/2 scale-50 overflow-hidden rounded-t-2xl bg-white shadow-panel">
        {item.html.trim() ? (
          <EmailPreviewFrame html={item.html} title={item.name} />
        ) : null}
      </div>
    </div>
  )
}

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
  const { state, addTemplate } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [layout, setLayout] = React.useState<TemplatesLayout>("grid")
  const [docsOpen, setDocsOpen] = React.useState(false)

  const needle = searchNeedle(query)
  const rows = state.templates.filter(
    (item) =>
      matchesNeedle(needle, item.name, item.alias) &&
      (status === "all" || item.status === status)
  )

  function createTemplate() {
    const created = addTemplate({ name: UNTITLED_TEMPLATE, subject: "" })
    toast.add({ type: "success", title: "Draft created" })
    router.push(`/templates/${created.id}`)
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
        <DocsButton onClick={() => setDocsOpen(true)} />
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
      {state.templates.length === 0 ? (
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
      ) : layout === "grid" ? (
        <ul
          data-testid="templates-grid"
          className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-x-6 gap-y-8"
        >
          {rows.map((item) => (
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
          {rows.map((item) => (
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
      <TemplatesDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
