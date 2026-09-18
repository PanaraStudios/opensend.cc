"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { GlobeIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  ListToolbar,
  MonoValue,
  MoreMenu,
  NotFoundState,
  OptionSelect,
  PageHeader,
  ResourceTable,
  StatusBadge,
  Surface,
  Th,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { REGIONS, type TlsMode } from "@/lib/dashboard/types"
import {
  dnsHost,
  domainDnsRecords,
  formatDate,
  isDomainName,
  pluralize,
  regionLabel,
  statusLabel,
} from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"

export function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addDomain, state } = useDashboard()
  const [name, setName] = React.useState("")
  const [region, setRegion] =
    React.useState<(typeof REGIONS)[number]["value"]>("us-east-1")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setRegion("us-east-1")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim().toLowerCase()
    if (!isDomainName(trimmed)) {
      setError("Enter a valid domain, like updates.example.com")
      return
    }
    if (state.domains.some((domain) => domain.name === trimmed)) {
      setError("That domain is already added")
      return
    }
    const domain = addDomain({ name: trimmed, region })
    toast.add({ type: "success", title: "Domain added" })
    reset()
    onOpenChange(false)
    router.push(`/domains/${domain.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add domain</DialogTitle>
            <DialogDescription>
              Use a domain you own. A subdomain such as{" "}
              <span className="font-mono">updates.example.com</span> keeps
              transactional reputation separate from marketing.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="domain-name">Domain</FieldLabel>
              <Input
                id="domain-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                placeholder="updates.example.com"
                autoFocus
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <FieldDescription>
                  Do not include http:// or a trailing path.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="domain-region">Region</FieldLabel>
              <OptionSelect
                id="domain-region"
                className="w-full"
                value={region}
                onChange={(next) => setRegion(next as typeof region)}
                items={REGION_ITEMS}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Add domain</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const TLS_ITEMS = [
  { value: "opportunistic", label: "Opportunistic" },
  { value: "enforced", label: "Enforced" },
]

const DOMAIN_STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  ...(["verified", "pending", "not_started", "failed"] as const).map(
    (value) => ({ value, label: statusLabel(value) })
  ),
]

const REGION_ITEMS = REGIONS.map((item) => ({
  value: item.value,
  label: `${item.label} (${item.code})`,
}))

export function DomainsView() {
  const { state, deleteDomain } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [region, setRegion] = React.useState("all")
  const [open, setOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.domains.filter(
    (domain) =>
      matchesNeedle(needle, domain.name) &&
      (status === "all" || domain.status === status) &&
      (region === "all" || domain.region === region)
  )

  return (
    <>
      <PageHeader
        title="Domains"
        description="Verify a domain you own to send email. DNS records are published here; SES stays on your AWS account."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Add domain
        </Button>
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search domains…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: DOMAIN_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
          {
            value: region,
            onChange: setRegion,
            items: [{ value: "all", label: "All regions" }, ...REGION_ITEMS],
            "aria-label": "Filter by region",
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={GlobeIcon}
          title="No domains"
          description="Add a domain you own to send email from addresses on that domain."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Add domain
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Domain</Th>
              <Th>Status</Th>
              <Th>Region</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((domain) => (
            <TableRow key={domain.id}>
              <TableCell>
                <Link
                  href={`/domains/${domain.id}`}
                  className="font-medium hover:underline"
                >
                  {domain.name}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={domain.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {regionLabel(domain.region)}
                <span className="ml-1 font-mono text-[12px]">
                  {domain.region}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(domain.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuItem
                    render={<Link href={`/domains/${domain.id}`} />}
                  >
                    View DNS records
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setPendingDelete(domain.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <AddDomainDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete domain?"
        description="You will not be able to send from this domain until you add it again and verify DNS."
        onConfirm={() => {
          if (pendingDelete) deleteDomain(pendingDelete)
          toast.add({ type: "success", title: "Domain deleted" })
        }}
      />
    </>
  )
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, deleteDomain, updateDomain, verifyDomain } = useDashboard()
  const domain = state.domains.find((item) => item.id === id)
  const { leaving, deleteAndLeave } = useDeleteRecord("/domains")
  const [tab, setTab] = React.useState("records")
  const [pendingDelete, setPendingDelete] = React.useState(false)

  if (!domain) {
    if (leaving) return null
    return <NotFoundState icon={GlobeIcon} noun="domain" backHref="/domains" />
  }

  const records = domainDnsRecords(domain)
  const pendingRecords = records.filter(
    (record) => record.status !== "verified"
  )
  const domainId = domain.id

  function runVerification() {
    verifyDomain(domainId)
    toast.add({
      type: "success",
      title: "Domain verified",
      description: "All DNS records now report as verified.",
    })
  }

  return (
    <>
      <DetailHeader
        backHref="/domains"
        backLabel="Domains"
        title={domain.name}
        badge={<StatusBadge status={domain.status} />}
        description={`${regionLabel(domain.region)} · ${domain.region} · Added ${formatDate(domain.createdAt)}`}
        actions={
          <>
            {domain.status !== "verified" ? (
              <Button onClick={runVerification}>Verify DNS Records</Button>
            ) : null}
            <Button variant="outline" onClick={() => setPendingDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="settings">Configuration</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "records" ? (
        <div className="space-y-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Add these records at your DNS provider. Copy Name and Content
            exactly. Opensend reads the values AWS returns for DKIM and SPF —
            API callers never see AWS credentials. DNS changes can take up to 72
            hours to propagate.
          </p>
          {pendingRecords.length > 0 ? (
            <Surface>
              <p className="text-small">
                <span className="text-foreground">
                  Waiting on {pluralize(pendingRecords.length, "record")}
                </span>
                {": "}
                <span className="text-muted-foreground">
                  {pendingRecords
                    .map((record) => `${record.kind} ${record.type}`)
                    .join(", ")}
                  .{" "}
                </span>
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={runVerification}
                >
                  Restart verification
                </button>
              </p>
            </Surface>
          ) : null}
          <ResourceTable
            className="[&_table]:table-fixed"
            headers={
              <>
                <Th className="w-24">Type</Th>
                <Th className="w-40">Name</Th>
                <Th>Content</Th>
                <Th className="w-16">TTL</Th>
                <Th className="w-20">Priority</Th>
                <Th className="w-32">Status</Th>
              </>
            }
          >
            {records.map((record) => {
              const host = dnsHost(record.name, domain.name)
              return (
                <TableRow key={record.id}>
                  <TableCell className="w-24 min-w-0">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-[13px]">
                        {record.type}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {record.kind}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="w-40 min-w-0">
                    <MonoValue copyValue={host}>{host}</MonoValue>
                  </TableCell>
                  <TableCell className="min-w-0">
                    <MonoValue copyValue={record.value}>
                      <span className="block max-w-full truncate">
                        {record.value}
                      </span>
                    </MonoValue>
                  </TableCell>
                  <TableCell className="w-16 min-w-0 text-muted-foreground">
                    {record.ttl}
                  </TableCell>
                  <TableCell className="w-20 min-w-0 text-muted-foreground">
                    {record.priority ?? "—"}
                  </TableCell>
                  <TableCell className="w-32 min-w-0">
                    <StatusBadge status={record.status} />
                  </TableCell>
                </TableRow>
              )
            })}
          </ResourceTable>
        </div>
      ) : (
        <Surface className="max-w-xl">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="open-tracking">
              <span className="flex flex-col gap-1">
                Open tracking
                <FieldDescription>
                  Adds a tracking pixel to measure opens on this domain.
                </FieldDescription>
              </span>
            </FieldLabel>
            <Switch
              id="open-tracking"
              checked={domain.openTracking}
              onCheckedChange={(checked) =>
                updateDomain(domain.id, { openTracking: checked })
              }
            />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="click-tracking">
              <span className="flex flex-col gap-1">
                Click tracking
                <FieldDescription>
                  Rewrites links so clicks can be attributed. Adds a Tracking
                  CNAME on the Records tab.
                </FieldDescription>
              </span>
            </FieldLabel>
            <Switch
              id="click-tracking"
              checked={domain.clickTracking}
              onCheckedChange={(checked) =>
                updateDomain(domain.id, { clickTracking: checked })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tls">TLS</FieldLabel>
            <OptionSelect
              id="tls"
              className="w-full"
              value={domain.tls}
              onChange={(next) =>
                updateDomain(domain.id, { tls: next as TlsMode })
              }
              items={TLS_ITEMS}
            />
            <FieldDescription>
              Enforced TLS only delivers when the receiving server supports TLS.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="return-path">Custom return-path</FieldLabel>
            <Input
              id="return-path"
              value={domain.customReturnPath}
              onChange={(event) =>
                updateDomain(domain.id, {
                  customReturnPath: event.target.value,
                })
              }
            />
            <FieldDescription>
              Subdomain used for the MX/SPF return-path, for example{" "}
              <span className="font-mono">send</span>.
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="receiving">
              <span className="flex flex-col gap-1">
                Receiving
                <FieldDescription>
                  Accept inbound mail on this domain. Adds an inbound MX on
                  Records. Messages show under Emails → Receiving.
                </FieldDescription>
              </span>
            </FieldLabel>
            <Switch
              id="receiving"
              checked={domain.receiving}
              onCheckedChange={(checked) =>
                updateDomain(domain.id, { receiving: checked })
              }
            />
          </Field>
        </Surface>
      )}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${domain.name}?`}
        description="Sending from this domain will stop. DNS records can stay at your registrar."
        onConfirm={() => {
          deleteAndLeave(() => deleteDomain(domain.id))
          toast.add({ type: "success", title: "Domain deleted" })
        }}
      />
    </>
  )
}
