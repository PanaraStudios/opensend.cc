"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, GlobeIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  Th,
} from "@/components/dashboard/primitives"
import { REGIONS } from "@/lib/dashboard/types"
import { formatDate, isDomainName, regionLabel } from "@/lib/dashboard/format"
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
  const [region, setRegion] = React.useState<(typeof REGIONS)[number]["value"]>(
    "us-east-1"
  )
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
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const rows = state.domains.filter((domain) => {
    if (query && !domain.name.includes(query.trim().toLowerCase())) return false
    if (status && domain.status !== status) return false
    if (region && domain.region !== region) return false
    return true
  })

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
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search domains…"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="All statuses"
          options={[
            { value: "verified", label: "Verified" },
            { value: "pending", label: "Pending" },
            { value: "not_started", label: "Not started" },
            { value: "failed", label: "Failed" },
          ]}
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
      </div>
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
          if (pendingDelete) deleteDomain(pendingDelete)
          toast.add({ type: "success", title: "Domain deleted" })
        }}
      />
    </>
  )
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, deleteDomain, updateDomain, verifyDomain } = useDashboard()
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

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/domains" />}
        >
          <ArrowLeftIcon />
          Domains
        </Button>
        <PageHeader title={domain.name}>
          {domain.status !== "verified" ? (
            <Button
              variant="secondary"
              onClick={() => {
                verifyDomain(domain.id)
                toast.add({
                  type: "success",
                  title: "Domain verified",
                  description: "All DNS records now report as verified.",
                })
              }}
            >
              Restart verification
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        </PageHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge status={domain.status} />
          <span>
            {regionLabel(domain.region)} · {domain.region}
          </span>
          <span>Added {formatDate(domain.createdAt)}</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "records" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add these records at your DNS provider. Opensend reads the values AWS
            returns for DKIM and SPF — API callers never see AWS credentials.
          </p>
          <ResourceTable
            headers={
              <>
                <Th>Type</Th>
                <Th>Name</Th>
                <Th>Value</Th>
                <Th>TTL</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
              </>
            }
          >
            {domain.records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <span className="font-mono text-[13px]">{record.type}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {record.kind}
                  </span>
                </TableCell>
                <TableCell>
                  <MonoValue copyValue={record.name}>{record.name}</MonoValue>
                </TableCell>
                <TableCell className="max-w-xs">
                  <MonoValue copyValue={record.value}>{record.value}</MonoValue>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {record.ttl}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {record.priority ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={record.status} />
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
        </div>
      ) : (
        <div className="max-w-lg space-y-6 rounded-xl border border-border bg-surface p-6">
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
                  Rewrites links so clicks can be attributed.
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
        </div>
      )}

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
