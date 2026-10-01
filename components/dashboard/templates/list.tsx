"use client"

import { EmailConfiguration } from "@/components/ses/email-configuration"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  FileCodeIcon,
  LayoutGridIcon,
  RefreshCwIcon,
  Rows3Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Th,
  useTeamList,
  useListSearch,
} from "@/components/dashboard/primitives"
import {
  TEMPLATE_STATUS_ITEMS,
  TemplateBadge,
  TemplateMenu,
  TemplateThumbnail,
} from "@/components/dashboard/templates/shared"
import { api } from "@/convex/_generated/api"
import { actionError } from "@/lib/action-error"
import { UNTITLED_TEMPLATE } from "@/lib/dashboard/template"
import type { EmailTemplate, TemplateStatus } from "@/lib/dashboard/types"

type TemplateChannel = NonNullable<EmailTemplate["channel"]>
import { pluralize } from "@/lib/dashboard/format"
import {
  MESSAGE_CHANNEL_ITEMS,
  ChannelCell,
  ChannelCreateMenu,
} from "@/components/dashboard/channels/shared"
import {
  asTemplate,
  useTemplateCommands,
  useWhatsAppAccounts,
} from "@/lib/templates/use-templates"

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
        <TemplateBadge item={item} />
        <div className="relative">
          <TemplateMenu item={item} />
        </div>
      </div>
    </li>
  )
}

export function TemplatesView() {
  const router = useRouter()
  const { organizationId, addTemplate, addWhatsAppTemplate, syncFromMeta } =
    useTemplateCommands()
  const accounts = useWhatsAppAccounts()
  const { query, setQuery, search } = useListSearch()
  const [status, setStatus] = React.useState("all")
  const [channel, setChannel] = React.useState("all")
  const [needsAccount, setNeedsAccount] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [layout, setLayout] = React.useState<TemplatesLayout>("grid")
  const creating = React.useRef(false)

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
      ...(channel !== "all" ? { channel: channel as TemplateChannel } : {}),
    },
    asListedTemplate
  )
  const hasTemplates = useQuery(
    api.templates.hasAny,
    organizationId ? { organizationId } : "skip"
  )

  async function createTemplate(kind: TemplateChannel) {
    if (creating.current) return
    // A WhatsApp template belongs to a connected WhatsApp Business Account.
    if (kind === "whatsapp" && accounts?.length === 0) {
      setNeedsAccount(true)
      return
    }
    creating.current = true
    try {
      const id =
        kind === "whatsapp"
          ? await addWhatsAppTemplate()
          : await addTemplate({ name: UNTITLED_TEMPLATE, subject: "" })
      toast.add({ type: "success", title: "Draft created" })
      router.push(`/templates/${id}`)
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      creating.current = false
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const { synced } = await syncFromMeta()
      toast.add({
        type: "success",
        title: `Synced ${pluralize(synced, "WhatsApp template")}`,
      })
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setSyncing(false)
    }
  }

  const createButton = (
    <ChannelCreateMenu
      noun="template"
      onCreate={(kind) => void createTemplate(kind)}
    />
  )

  return (
    <>
      <PageHeader title="Templates">
        <DocsButton />
        {accounts?.length ? (
          <Button
            variant="outline"
            disabled={syncing}
            data-testid="sync-from-meta"
            onClick={() => void sync()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {syncing ? "Syncing…" : "Sync from Meta"}
          </Button>
        ) : null}
        {createButton}
      </PageHeader>
      {needsAccount ? (
        <Alert variant="warning" data-testid="whatsapp-account-needed">
          <TriangleAlertIcon />
          <AlertTitle>Connect WhatsApp first</AlertTitle>
          <AlertDescription>
            A WhatsApp template belongs to a WhatsApp Business Account.{" "}
            <Link href="/channels">Connect one on the Channels page</Link>.
          </AlertDescription>
        </Alert>
      ) : null}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search templates…"
        filters={[
          {
            value: channel,
            onChange: setChannel,
            items: MESSAGE_CHANNEL_ITEMS,
            "aria-label": "Filter by channel",
          },
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
      <EmailConfiguration required={channel === "email"}>
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
            description="Nothing matches this search and these filters."
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
                    <Th>Channel</Th>
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
                      <ChannelCell channel={item.channel} />
                    </TableCell>
                    <TableCell>
                      <TemplateBadge item={item} />
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
      </EmailConfiguration>
    </>
  )
}
