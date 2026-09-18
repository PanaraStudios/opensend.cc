"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRightIcon, CloudIcon, GlobeIcon } from "lucide-react"

import { CloudflareIcon } from "@/components/brand-icons"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  DocsSheet,
  MonoValue,
  ResourceTable,
  StatusBadge,
  Th,
} from "@/components/dashboard/primitives"
import { REGIONS } from "@/lib/dashboard/types"
import type { DnsProvider, DnsRecord, Domain } from "@/lib/dashboard/types"
import {
  dnsHost,
  providerLabel,
  providerUrl,
  regionFlag,
  truncateMiddle,
} from "@/lib/dashboard/domains"
import { regionLabel, statusLabel } from "@/lib/dashboard/format"
import { cn } from "@/lib/utils"
import type { SelectOption } from "@/components/dashboard/primitives"

export const DomainIcon = GlobeIcon

/** Where the docs for a record type live. One page for now. */
export const DNS_DOCS_HREF = "/docs"

export const REGION_ITEMS: readonly SelectOption[] = REGIONS.map((item) => ({
  value: item.value,
  label: `${item.label} (${item.code})`,
}))

export const DOMAIN_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...(
    [
      "pending",
      "verified",
      "partially_verified",
      "failed",
      "not_started",
    ] as const
  ).map((value) => ({ value, label: statusLabel(value) })),
]

export const TLS_ITEMS: readonly SelectOption[] = [
  { value: "opportunistic", label: "Opportunistic" },
  { value: "enforced", label: "Enforced" },
]

/** Flag, name, and code for a sending region. */
export function RegionValue({ domain }: { domain: Domain }) {
  return (
    <>
      <span aria-hidden="true">{regionFlag(domain.region)}</span>
      <span className="truncate">
        {regionLabel(domain.region)}{" "}
        <span className="text-muted-foreground">({domain.region})</span>
      </span>
    </>
  )
}

export function ProviderMark({
  provider,
  className,
}: {
  provider: DnsProvider | undefined
  className?: string
}) {
  return provider === "cloudflare" ? (
    <CloudflareIcon className={className} />
  ) : (
    <CloudIcon className={className ?? "size-4 shrink-0"} />
  )
}

/** Detected DNS provider, linked to its dashboard when we know the URL. */
export function ProviderValue({ domain }: { domain: Domain }) {
  const url = providerUrl(domain.provider)
  const label = providerLabel(domain.provider)
  return (
    <>
      <ProviderMark provider={domain.provider} />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-0.5 hover:text-foreground"
        >
          <span className="truncate">{label}</span>
          <ArrowUpRightIcon className="size-3 shrink-0" />
        </a>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </>
  )
}

/** One block of a domain panel: heading, optional switch, an optional record
    type linked to its docs, and whatever the block holds. Both tabs are
    built out of these. */
export function DomainSection({
  title,
  description,
  docLabel,
  toggle,
  divider = false,
  children,
}: {
  title: string
  description?: string
  docLabel?: string
  toggle?: { checked: boolean; onCheckedChange: (checked: boolean) => void }
  /** Rule above the block, to separate it from the one before. */
  divider?: boolean
  children?: React.ReactNode
}) {
  const id = `domain-section-${title.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        divider && "border-t border-border pt-5"
      )}
      aria-labelledby={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={id} className="text-sm font-medium">
            {title}
          </h3>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {toggle ? (
          <Switch
            aria-label={title}
            checked={toggle.checked}
            onCheckedChange={toggle.onCheckedChange}
          />
        ) : null}
      </div>
      {docLabel ? (
        <Link
          href={DNS_DOCS_HREF}
          className="inline-flex w-fit items-center gap-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {docLabel}
          <ArrowUpRightIcon className="size-3 shrink-0" />
        </Link>
      ) : null}
      {children}
    </section>
  )
}

/** The DNS table, shared by every block and by the tracking record on the
    Configuration tab. Name and Content copy the full value on click. */
export function DnsRecordsTable({
  records,
  domainName,
  showPriority = false,
}: {
  records: readonly DnsRecord[]
  domainName: string
  showPriority?: boolean
}) {
  return (
    <ResourceTable
      className="[&_table]:table-fixed"
      headers={
        <>
          <Th className="w-20">Type</Th>
          <Th className="w-44">Name</Th>
          <Th>Content</Th>
          <Th className="w-20">TTL</Th>
          {showPriority ? <Th className="w-20">Priority</Th> : null}
          <Th className="w-32">Status</Th>
        </>
      }
    >
      {records.map((record) => {
        const host = dnsHost(record.name, domainName)
        return (
          <TableRow key={record.id}>
            <TableCell className="w-20 min-w-0 font-mono text-[13px]">
              {record.type}
            </TableCell>
            <TableCell className="w-44 min-w-0">
              <MonoValue copyValue={record.name}>{host}</MonoValue>
            </TableCell>
            <TableCell className="min-w-0">
              <MonoValue copyValue={record.value}>
                {truncateMiddle(record.value)}
              </MonoValue>
            </TableCell>
            <TableCell className="w-20 min-w-0 text-muted-foreground">
              {record.ttl}
            </TableCell>
            {showPriority ? (
              <TableCell className="w-20 min-w-0 text-muted-foreground">
                {record.priority ?? "—"}
              </TableCell>
            ) : null}
            <TableCell className="w-32 min-w-0">
              <StatusBadge status={record.status} />
            </TableCell>
          </TableRow>
        )
      })}
    </ResourceTable>
  )
}

const DOMAIN_DOCS = [
  {
    title: "Add a domain",
    body: "A subdomain such as updates.example.com keeps transactional reputation separate from marketing, and leaves your root domain alone.",
  },
  {
    title: "Verification",
    body: "Add the DKIM and SPF records at your DNS provider, then start verification. DNS changes can take up to 72 hours to propagate.",
  },
  {
    title: "Receiving",
    body: "Turning receiving on adds an inbound MX record at the apex. The domain reads as partially verified until that record resolves.",
  },
  {
    title: "Where SES lives",
    body: "Opensend publishes the record values AWS returns and reads their status back. SES stays on your AWS account, and API callers never see your credentials.",
  },
]

export function DomainsDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Domains"
      description="Verify a domain you own, then send from any address on it."
      sections={DOMAIN_DOCS}
    />
  )
}

/** Hand the browser a generated file, the way the record menu offers a zone
    file. Kept here so the callers stay declarative. */
export function downloadTextFile(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
