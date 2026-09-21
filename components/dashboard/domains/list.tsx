"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronDownIcon,
  CopyIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmptyState,
  ListToolbar,
  ListPagination,
  usePagination,
  MoreMenu,
  OptionSelect,
  PageHeader,
  RelativeTime,
  ResourceTable,
  StatusBadge,
  Th,
  copyToClipboard,
} from "@/components/dashboard/primitives"
import {
  DOMAIN_STATUS_ITEMS,
  DomainIcon,
  DomainsDocsSheet,
  REGION_ITEMS,
  RegionValue,
} from "@/components/dashboard/domains/shared"
import {
  DEFAULT_RETURN_PATH,
  validateDnsLabel,
  validateDomainName,
} from "@/lib/dashboard/domains"
import { usePaginatedQuery, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { asDomain, useDomainCommands } from "@/lib/domains/use-domains"
import { actionError } from "@/lib/action-error"
import { Skeleton } from "@/components/ui/skeleton"
import type { Region } from "@/lib/dashboard/types"

export function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addDomain } = useDomainCommands()
  const installation = useQuery(api.installation.status)
  const [pending, setPending] = React.useState(false)
  const [name, setName] = React.useState("")
  const [chosenRegion, setRegion] = React.useState<Region | undefined>()
  const region =
    chosenRegion ?? installation?.installation?.defaultRegion ?? "us-east-1"
  const [returnPath, setReturnPath] = React.useState(DEFAULT_RETURN_PATH)
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setRegion(undefined)
    setReturnPath(DEFAULT_RETURN_PATH)
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const nameError = validateDomainName(name, [])
    if (nameError) {
      setError(nameError)
      return
    }
    const pathError = validateDnsLabel(returnPath)
    if (pathError) {
      setError(pathError)
      return
    }
    setPending(true)
    try {
      const id = await addDomain({
        name,
        region,
        customReturnPath: returnPath,
      })
      toast.add({
        type: "success",
        title: "Domain added",
        description: "Add the DNS records below, then start verification.",
      })
      reset()
      onOpenChange(false)
      router.push(`/domains/${id}`)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
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
                <FieldError>{error}</FieldError>
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
                onChange={(next) => setRegion(next as Region)}
                items={REGION_ITEMS.filter((item) =>
                  installation?.regions.some(
                    (saved) =>
                      saved.region === item.value && saved.phase === "ready"
                  )
                )}
              />
              <FieldDescription>
                The AWS region your SES identity lives in.
              </FieldDescription>
            </Field>
            <Collapsible className="flex flex-col gap-3">
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="group -ml-2 w-fit text-foreground"
                  />
                }
              >
                <ChevronDownIcon
                  data-icon="inline-start"
                  className="-rotate-90 transition-transform group-data-[panel-open]:rotate-0"
                />
                Advanced options
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Field>
                  <FieldLabel htmlFor="domain-return-path">
                    Custom Return-Path
                  </FieldLabel>
                  <Input
                    id="domain-return-path"
                    value={returnPath}
                    onChange={(event) => {
                      setReturnPath(event.target.value)
                      setError(null)
                    }}
                    placeholder={DEFAULT_RETURN_PATH}
                  />
                  <FieldDescription>
                    Subdomain that carries the MX and SPF records for bounces.
                    It cannot be changed later.
                  </FieldDescription>
                </Field>
              </CollapsibleContent>
            </Collapsible>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DomainsView() {
  const { organizationId, canWrite, deleteDomain, verifyDomain } =
    useDomainCommands()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [region, setRegion] = React.useState("all")
  const [addOpen, setAddOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const {
    results,
    status: loading,
    loadMore,
  } = usePaginatedQuery(
    api.domains.list,
    organizationId
      ? {
          organizationId,
          search: query,
          ...(status !== "all"
            ? {
                status: status as
                  "pending" | "verified" | "partially_verified" | "failed",
              }
            : {}),
          ...(region !== "all" ? { region: region as Region } : {}),
        }
      : "skip",
    { initialNumItems: 40 }
  )
  const rows = results.map(asDomain)
  const { pageRows, pagination } = usePagination(rows)
  async function verify(id: string) {
    try {
      await verifyDomain(id)
      toast.add({ type: "success", title: "Verification queued" })
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    }
  }

  return (
    <>
      <PageHeader
        title="Domains"
        description="Verify a domain you own to send email. DNS records are published here. SES stays on your AWS account."
      >
        <Button disabled={!canWrite} onClick={() => setAddOpen(true)}>
          <PlusIcon />
          Add domain
        </Button>
        <DocsButton onClick={() => setDocsOpen(true)} />
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search domain prefix…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: DOMAIN_STATUS_ITEMS.filter((item) =>
              [
                "all",
                "pending",
                "verified",
                "partially_verified",
                "failed",
              ].includes(item.value)
            ),
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
      {loading === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DomainIcon}
          title={
            !query && status === "all" && region === "all"
              ? "No domains"
              : "No domains found"
          }
          description={
            !query && status === "all" && region === "all"
              ? "Add a domain you own to send email from addresses on that domain."
              : "No domains match these filters."
          }
        >
          {!query && status === "all" && region === "all" ? (
            <Button disabled={!canWrite} onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add domain
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
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
            {pageRows.map((domain) => (
              <TableRow key={domain.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="icon-tile size-8 rounded-lg [&_svg]:size-4">
                      <DomainIcon />
                    </span>
                    <Link
                      href={`/domains/${domain.id}`}
                      className="font-medium hover:underline"
                    >
                      {domain.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={domain.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <RegionValue domain={domain} />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={domain.createdAt} />
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={`/domains/${domain.id}`} />}
                      >
                        <DomainIcon />
                        View DNS records
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void copyToClipboard(domain.name, "Domain")
                        }
                      >
                        <CopyIcon />
                        Copy domain
                      </DropdownMenuItem>
                      {domain.status === "verified" ? null : (
                        <DropdownMenuItem
                          disabled={!canWrite}
                          onClick={() => void verify(domain.id)}
                        >
                          <RefreshCwIcon />
                          Verify DNS records
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        disabled={!canWrite}
                        variant="destructive"
                        onClick={() => setPendingDelete(domain.id)}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination
            {...pagination}
            noun="domain"
            hasMore={loading !== "Exhausted"}
            loading={loading === "LoadingMore"}
            onPageChange={(page) => {
              if (
                (page + 1) * pagination.pageSize > rows.length &&
                loading === "CanLoadMore"
              )
                loadMore(pagination.pageSize)
              pagination.onPageChange(page)
            }}
            onPageSizeChange={(size) => {
              pagination.onPageSizeChange(size)
              if (size > rows.length && loading === "CanLoadMore")
                loadMore(size - rows.length)
            }}
          />
        </>
      )}
      <AddDomainDialog open={addOpen} onOpenChange={setAddOpen} />
      <DomainsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete domain?"
        description="You cannot send from this domain until you add it again and verify DNS."
        onConfirm={async () => {
          if (pendingDelete) await deleteDomain(pendingDelete)
          toast.add({ type: "success", title: "Domain removal queued" })
        }}
      />
    </>
  )
}
