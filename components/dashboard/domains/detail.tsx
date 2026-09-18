"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import {
  BadgeCheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  ListChecksIcon,
  RefreshCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ConfirmDialog,
  DetailHeader,
  DocsButton,
  EventTrail,
  MetaStrip,
  MonoValue,
  MoreMenu,
  NotFoundState,
  OptionSelect,
  RelativeTime,
  StatusBadge,
  Surface,
  copyToClipboard,
  useDeleteRecord,
  type EventTrailStep,
} from "@/components/dashboard/primitives"
import {
  DnsRecordsTable,
  DomainIcon,
  DomainSection,
  DomainsDocsSheet,
  ProviderMark,
  ProviderValue,
  RegionValue,
  TLS_ITEMS,
  downloadZoneFile,
} from "@/components/dashboard/domains/shared"
import {
  DEFAULT_TRACKING_SUBDOMAIN,
  canAutoConfigure,
  domainBanner,
  domainEventSteps,
  domainRecordSections,
  domainTrackingRecords,
  domainZoneFile,
  providerLabel,
  trackingEnabled,
  validateDnsLabel,
  type DomainBanner,
  type DomainEventStep,
} from "@/lib/dashboard/domains"
import { formatDateTime } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { Domain, TlsMode } from "@/lib/dashboard/types"

const BANNER_ICON: Record<DomainBanner["tone"], LucideIcon> = {
  success: CircleCheckIcon,
  warning: ClockIcon,
  destructive: CircleAlertIcon,
  default: InfoIcon,
}

const EVENT_ICON: Record<DomainEventStep["type"], LucideIcon> = {
  added: DomainIcon,
  dns_verified: ListChecksIcon,
  partially_verified: CircleCheckIcon,
  verified: BadgeCheckIcon,
}

function DomainStatusAlert({ domain }: { domain: Domain }) {
  const banner = domainBanner(domain.status)
  const Icon = BANNER_ICON[banner.tone]
  return (
    <Alert variant={banner.tone}>
      <Icon />
      <AlertTitle>{banner.title}</AlertTitle>
      <AlertDescription>{banner.description}</AlertDescription>
    </Alert>
  )
}

function DomainEvents({ domain }: { domain: Domain }) {
  const steps: EventTrailStep[] = domainEventSteps(domain).map((step) => ({
    id: step.type,
    icon: EVENT_ICON[step.type],
    label: step.label,
    caption: step.at === undefined ? undefined : formatDateTime(step.at),
  }))
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Domain events</h2>
      <EventTrail steps={steps} />
    </section>
  )
}

function AutoConfigureDialog({
  open,
  onOpenChange,
  domain,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: Domain
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Auto configure DNS</DialogTitle>
          <DialogDescription>
            Opensend writes the records below into{" "}
            {providerLabel(domain.provider)} for {domain.name} using the
            connected account, then checks them. Your SES identity and AWS
            credentials are untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Add records
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TrackingDialog({
  open,
  onOpenChange,
  domain,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: Domain
}) {
  const { updateDomain } = useDashboard()
  const [subdomain, setSubdomain] = React.useState(
    domain.trackingSubdomain || DEFAULT_TRACKING_SUBDOMAIN
  )
  const [click, setClick] = React.useState(domain.clickTracking)
  const [openTracking, setOpenTracking] = React.useState(domain.openTracking)
  const [error, setError] = React.useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const labelError = validateDnsLabel(subdomain)
    if (labelError) {
      setError(labelError)
      return
    }
    updateDomain(domain.id, {
      trackingSubdomain: subdomain.trim().toLowerCase(),
      clickTracking: click,
      openTracking,
    })
    toast.add({
      type: "success",
      title: "Tracking configured",
      description: "Add the CNAME record to finish.",
    })
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Configure tracking</DialogTitle>
            <DialogDescription>
              Links and pixels are rewritten to this subdomain so they match
              your sending domain.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="tracking-subdomain">
                Tracking subdomain
              </FieldLabel>
              <Input
                id="tracking-subdomain"
                value={subdomain}
                onChange={(event) => {
                  setSubdomain(event.target.value)
                  setError(null)
                }}
                placeholder={DEFAULT_TRACKING_SUBDOMAIN}
                autoFocus
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldDescription>
                  Rewritten links become{" "}
                  <span className="font-mono">
                    {subdomain || DEFAULT_TRACKING_SUBDOMAIN}.{domain.name}
                  </span>
                  .
                </FieldDescription>
              )}
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="tracking-click">
                <span className="flex flex-col gap-1">
                  Click tracking
                  <FieldDescription>
                    Rewrites links so clicks can be attributed.
                  </FieldDescription>
                </span>
              </FieldLabel>
              <Switch
                id="tracking-click"
                checked={click}
                onCheckedChange={setClick}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="tracking-open">
                <span className="flex flex-col gap-1">
                  Open tracking
                  <FieldDescription>
                    Adds a tracking pixel to measure opens.
                  </FieldDescription>
                </span>
              </FieldLabel>
              <Switch
                id="tracking-open"
                checked={openTracking}
                onCheckedChange={setOpenTracking}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DomainRecords({ domain }: { domain: Domain }) {
  const { addExport, updateDomain, verifyDomain } = useDashboard()
  const [autoOpen, setAutoOpen] = React.useState(false)
  const sections = domainRecordSections(domain)
  const zone = domainZoneFile(domain)
  const canAuto = canAutoConfigure(domain.provider)
  const verifyLabel =
    domain.status === "not_started"
      ? "Verify DNS records"
      : "Restart verification"

  function runVerification(title: string) {
    verifyDomain(domain.id)
    toast.add({
      type: "success",
      title,
      description: "Every record this domain needs now resolves.",
    })
  }

  const autoConfigureButton = (
    <Button
      variant="outline"
      disabled={!canAuto}
      onClick={() => setAutoOpen(true)}
    >
      <ProviderMark provider={domain.provider} className="size-4 shrink-0" />
      Auto configure
    </Button>
  )

  return (
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">DNS Records</h2>
        <div className="flex items-center gap-2">
          {canAuto ? (
            autoConfigureButton
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {autoConfigureButton}
              </TooltipTrigger>
              <TooltipContent>
                {domain.provider
                  ? `Opensend cannot write records into ${providerLabel(domain.provider)} yet.`
                  : "We could not detect a DNS provider for this domain."}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={verifyLabel}
                  onClick={() => runVerification("Verification finished")}
                />
              }
            >
              <RefreshCwIcon />
            </TooltipTrigger>
            <TooltipContent>{verifyLabel}</TooltipContent>
          </Tooltip>
          <MoreMenu>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => void copyToClipboard(zone, "Records")}
              >
                <CopyIcon />
                Copy all records
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadZoneFile(domain)}>
                <DownloadIcon />
                Download zone file
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  addExport(`Records for ${domain.name}`, domain.records.length)
                  toast.add({ type: "success", title: "Export started" })
                }}
              >
                <DownloadIcon />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MoreMenu>
        </div>
      </div>
      {sections.map((section, index) => (
        <DomainSection
          key={section.id}
          title={section.title}
          description={section.description}
          docLabel={section.enabled ? section.docLabel : undefined}
          divider={index > 0}
          toggle={
            section.toggle
              ? {
                  checked: section.enabled,
                  onCheckedChange: (checked) =>
                    updateDomain(
                      domain.id,
                      section.toggle === "sending"
                        ? { sending: checked }
                        : { receiving: checked }
                    ),
                }
              : undefined
          }
        >
          {section.enabled && section.records.length > 0 ? (
            <DnsRecordsTable
              records={section.records}
              domainName={domain.name}
              showPriority={section.showPriority}
            />
          ) : null}
        </DomainSection>
      ))}
      <AutoConfigureDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        domain={domain}
        onConfirm={() => runVerification("Records added")}
      />
    </Surface>
  )
}

function DomainConfiguration({ domain }: { domain: Domain }) {
  const { updateDomain } = useDashboard()
  const [trackingOpen, setTrackingOpen] = React.useState(false)
  const tracking = trackingEnabled(domain)
  const trackingRecords = domainTrackingRecords(domain)

  return (
    <Surface>
      <h2 className="text-base font-medium">Configuration</h2>
      <DomainSection
        title="Enable tracking metrics"
        description="To track clicks and email opens, configure a custom tracking subdomain to let those links match your sending domain and improve deliverability."
      >
        {tracking ? (
          <>
            <p className="text-sm text-muted-foreground">
              Tracking through{" "}
              <MonoValue
                copyValue={`${domain.trackingSubdomain}.${domain.name}`}
              >
                {domain.trackingSubdomain}.{domain.name}
              </MonoValue>{" "}
              · clicks {domain.clickTracking ? "on" : "off"} · opens{" "}
              {domain.openTracking ? "on" : "off"}
            </p>
            <DnsRecordsTable
              records={trackingRecords}
              domainName={domain.name}
            />
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setTrackingOpen(true)}>
            Configure
          </Button>
          {tracking ? (
            <Button
              variant="ghost"
              onClick={() => {
                updateDomain(domain.id, {
                  trackingSubdomain: "",
                  clickTracking: false,
                  openTracking: false,
                })
                toast.add({ type: "success", title: "Tracking disabled" })
              }}
            >
              Disable tracking
            </Button>
          ) : null}
        </div>
      </DomainSection>
      <DomainSection
        divider
        title="TLS (Transport Layer Security)"
        description={`"Opportunistic TLS" means that it always attempts to make a secure connection to the receiving mail server. If it can't establish a secure connection, it sends the message unencrypted. "Enforced TLS" on the other hand, requires that the email communication must use TLS no matter what.`}
      >
        <OptionSelect
          id="domain-tls"
          className="w-full sm:max-w-56"
          aria-label="TLS"
          value={domain.tls}
          onChange={(next) => updateDomain(domain.id, { tls: next as TlsMode })}
          items={TLS_ITEMS}
        />
      </DomainSection>
      <DomainSection
        divider
        title="Return-Path"
        description="Bounces and complaints come back to this subdomain. It is set when the domain is added, because the MX and SPF records carry its name."
      >
        <MonoValue copyValue={`${domain.customReturnPath}.${domain.name}`}>
          {domain.customReturnPath}.{domain.name}
        </MonoValue>
      </DomainSection>
      {/* Keyed on the saved values so reopening the dialog shows them, not
          the draft it mounted with. */}
      <TrackingDialog
        key={`${domain.trackingSubdomain}-${domain.clickTracking}-${domain.openTracking}`}
        open={trackingOpen}
        onOpenChange={setTrackingOpen}
        domain={domain}
      />
    </Surface>
  )
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, deleteDomain } = useDashboard()
  const domain = state.domains.find((item) => item.id === id)
  const { leaving, deleteAndLeave } = useDeleteRecord("/domains")
  const [tab, setTab] = React.useState("records")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState(false)

  if (!domain) {
    if (leaving) return null
    return <NotFoundState icon={DomainIcon} noun="domain" backHref="/domains" />
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/domains"
        backLabel="Domains"
        title={domain.name}
        icon={DomainIcon}
        actions={
          <>
            <DocsButton onClick={() => setDocsOpen(true)} />
            <MoreMenu>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => void copyToClipboard(domain.name, "Domain")}
                >
                  <CopyIcon />
                  Copy domain
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadZoneFile(domain)}>
                  <DownloadIcon />
                  Download zone file
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setPendingDelete(true)}
              >
                <Trash2Icon />
                Delete domain
              </DropdownMenuItem>
            </MoreMenu>
          </>
        }
      />
      <MetaStrip
        items={[
          { label: "Created", value: <RelativeTime at={domain.createdAt} /> },
          { label: "Status", value: <StatusBadge status={domain.status} /> },
          { label: "Provider", value: <ProviderValue domain={domain} /> },
          { label: "Region", value: <RegionValue domain={domain} /> },
        ]}
      />
      <DomainStatusAlert domain={domain} />
      <DomainEvents domain={domain} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "records" ? (
        <DomainRecords domain={domain} />
      ) : (
        <DomainConfiguration domain={domain} />
      )}
      <DomainsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
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
    </div>
  )
}
