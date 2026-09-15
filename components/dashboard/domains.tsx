"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, GlobeIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmptyState,
  FilterSelect,
  MonoValue,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  StatusBadge,
  Surface,
  Th,
  Toolbar,
} from "@/components/dashboard/primitives"
import { REGIONS } from "@/lib/dashboard/types"
import {
  dnsHost,
  domainDnsRecords,
  domainNeedsVerification,
  formatDate,
  isDomainName,
  regionLabel,
} from "@/lib/dashboard/format"
import type { Domain, DomainStatus } from "@/lib/dashboard/types"
import { useDashboard } from "@/lib/dashboard/store"

const DOMAIN_STATUS_FILTERS: { value: DomainStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "partially_verified", label: "Partially verified" },
  { value: "partially_failed", label: "Partially failed" },
  { value: "failed", label: "Failed" },
  { value: "temporary_failure", label: "Temporary failure" },
]

function DomainDetailHeader({
  domain,
  actions,
}: {
  domain: Domain
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="-ml-2 w-fit text-muted-foreground"
        render={<Link href="/domains" />}
      >
        <ArrowLeftIcon />
        Domains
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-tile">
            <GlobeIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="title-gradient text-h3 break-all">{domain.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={domain.status} />
              <span className="text-small text-muted-foreground">
                {regionLabel(domain.region)} · {domain.region}
              </span>
              <span className="text-small text-muted-foreground">
                Added {formatDate(domain.createdAt)}
              </span>
            </div>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

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
  const [region, setRegion] = React.useState<(typeof REGIONS)[number]["value"]>(
    "us-east-1"
  )
  const [returnPath, setReturnPath] = React.useState("send")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setRegion("us-east-1")
    setReturnPath("send")
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
    const path = returnPath.trim() || "send"
    if (!/^[a-z0-9-]+$/i.test(path)) {
      setError("Return-path must be a single subdomain label")
      return
    }
    const domain = addDomain({ name: trimmed, region, customReturnPath: path })
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
              Send from a subdomain you own, such as{" "}
              <span className="font-mono">updates.example.com</span>, instead of
              the root domain. Each subdomain is verified separately.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="domain-name">Name</FieldLabel>
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
                  Do not include http:// or a path.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="domain-region">Region</FieldLabel>
              <select
                id="domain-region"
                value={region}
                onChange={(event) =>
                  setRegion(event.target.value as typeof region)
                }
                className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
              >
                {REGIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label} ({item.code})
                  </option>
                ))}
              </select>
              <FieldDescription>
                Choose the region closest to most recipients.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="domain-return-path">
                Custom return-path
              </FieldLabel>
              <Input
                id="domain-return-path"
                value={returnPath}
                onChange={(event) => setReturnPath(event.target.value)}
                placeholder="send"
              />
              <FieldDescription>
                Optional. Defaults to{" "}
                <span className="font-mono">send.your-domain</span> for bounce
                and SPF records.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add domain</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DomainsView() {
  const { state, deleteDomain } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [region, setRegion] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)

  const rows = state.domains.filter((domain) => {
    if (query && !domain.name.includes(query.trim().toLowerCase())) return false
    if (status && domain.status !== status) return false
    if (region && domain.region !== region) return false
    return true
  })

  const allSelected =
    rows.length > 0 && rows.every((domain) => selected.has(domain.id))
  const someSelected = rows.some((domain) => selected.has(domain.id))

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) {
        for (const domain of rows) next.add(domain.id)
      } else {
        for (const domain of rows) next.delete(domain.id)
      }
      return next
    })
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function deleteSelected() {
    for (const id of selected) deleteDomain(id)
    setSelected(new Set())
    toast.add({ type: "success", title: "Domains deleted" })
  }

  return (
    <>
      <PageHeader
        title="Domains"
        description="Send email from domains you own. Verify DNS once, then send through the Resend-compatible API or SMTP."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Add domain
        </Button>
      </PageHeader>
      <Toolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search domains…"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="All statuses"
          options={DOMAIN_STATUS_FILTERS}
        />
        <FilterSelect
          value={region}
          onChange={setRegion}
          placeholder="All regions"
          options={REGIONS.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
        />
      </Toolbar>
      {someSelected ? (
        <Surface className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            {selected.size} domain{selected.size === 1 ? "" : "s"} selected
          </p>
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            Delete
          </Button>
        </Surface>
      ) : null}
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
              <Th className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all domains"
                />
              </Th>
              <Th>Domain</Th>
              <Th>Status</Th>
              <Th>Region</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((domain) => (
            <TableRow key={domain.id} data-state={selected.has(domain.id) ? "selected" : undefined}>
              <TableCell>
                <Checkbox
                  checked={selected.has(domain.id)}
                  onCheckedChange={(checked) => toggleOne(domain.id, checked === true)}
                  aria-label={`Select ${domain.name}`}
                />
              </TableCell>
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
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(domain.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem render={<Link href={`/domains/${domain.id}`} />}>
                    View DNS records
                  </MoreMenuItem>
                  <MoreMenuItem
                    variant="destructive"
                    onClick={() => setPendingDelete(domain.id)}
                  >
                    Delete
                  </MoreMenuItem>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <AddDomainDialog open={open} onOpenChange={setOpen} />
      <ConfirmDelete
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete domain?"
        description="You will not be able to send from this domain until you add it again and verify DNS."
        onConfirm={() => {
          if (pendingDelete) {
            deleteDomain(pendingDelete)
            setSelected((current) => {
              const next = new Set(current)
              next.delete(pendingDelete)
              return next
            })
          }
          toast.add({ type: "success", title: "Domain deleted" })
        }}
      />
      <ConfirmDelete
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selected.size} domain${selected.size === 1 ? "" : "s"}?`}
        description="Sending from these domains will stop until you add and verify them again."
        onConfirm={deleteSelected}
      />
    </>
  )
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, deleteDomain, updateDomain, beginDomainVerification } =
    useDashboard()
  const domain = state.domains.find((item) => item.id === id)
  const [tab, setTab] = React.useState("records")
  const [pendingDelete, setPendingDelete] = React.useState(false)

  if (!domain) {
    return (
      <EmptyState
        icon={GlobeIcon}
        title="Domain not found"
        description="It may have been deleted from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/domains" />}>
          Back to domains
        </Button>
      </EmptyState>
    )
  }

  const records = domainDnsRecords(domain)
  const pendingRecords = records.filter((record) => record.status !== "verified")
  const domainId = domain.id
  const needsVerification = domainNeedsVerification(domain.status)

  function restartVerification() {
    beginDomainVerification(domainId)
    toast.add({
      type: "success",
      title: "Verification restarted",
      description: "DNS is checked again. Propagation can take up to 72 hours.",
    })
  }

  const verifyAction =
    domain.status === "not_started" ? (
      <Button onClick={restartVerification}>Verify DNS Records</Button>
    ) : needsVerification ? (
      <Button onClick={restartVerification}>Restart verification</Button>
    ) : null

  return (
    <>
      <DomainDetailHeader
        domain={domain}
        actions={
          <>
            {verifyAction}
            <Button variant="outline" onClick={() => setPendingDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>
        <TabsContent value="records" className="space-y-4 pt-4">
          <p className="max-w-2xl text-small text-muted-foreground">
            Add these records at your DNS provider. Copy Name and Content
            exactly — mismatches are the most common verification failure. DNS
            often verifies within 15 minutes but can take up to 72 hours to
            propagate.
          </p>
          {pendingRecords.length > 0 ? (
            <Surface>
              <p className="text-small">
                <span className="text-foreground">
                  Waiting on {pendingRecords.length}{" "}
                  {pendingRecords.length === 1 ? "record" : "records"}
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
                  onClick={restartVerification}
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
                      <span className="font-mono text-[13px]">{record.type}</span>
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
          <Surface>
            <p className="text-sm font-medium">DMARC</p>
            <p className="text-small text-muted-foreground">
              After the domain verifies, add the DMARC TXT record shown above.
              Start with <span className="font-mono">p=none</span>, then tighten
              the policy once aggregate reports look clean.
            </p>
          </Surface>
        </TabsContent>
        <TabsContent value="configuration" className="pt-4">
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
              <select
                id="tls"
                value={domain.tls}
                onChange={(event) =>
                  updateDomain(domain.id, {
                    tls: event.target.value as "opportunistic" | "enforced",
                  })
                }
                className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
              >
                <option value="opportunistic">Opportunistic</option>
                <option value="enforced">Enforced</option>
              </select>
              <FieldDescription>
                Enforced TLS only delivers when the receiving server supports
                TLS.
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
        </TabsContent>
      </Tabs>

      <ConfirmDelete
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${domain.name}?`}
        description="Sending from this domain will stop. DNS records can stay at your registrar."
        onConfirm={() => {
          deleteDomain(domain.id)
          toast.add({ type: "success", title: "Domain deleted" })
          router.push("/domains")
        }}
      />
    </>
  )
}
