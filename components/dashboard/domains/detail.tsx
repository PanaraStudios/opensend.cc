"use client"
import * as React from "react"
import { useParams } from "next/navigation"
import { useQuery, useMutation, useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ConfirmDialog,
  DetailHeader,
  DetailSection,
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
  downloadTextFile,
} from "@/components/dashboard/domains/shared"
import {
  canAutoConfigure,
  domainBanner,
  domainCsvFile,
  domainEventSteps,
  domainRecords,
  domainRecordSections,
  domainTrackingRecords,
  domainZoneFile,
  providerLabel,
  trackingEnabled,
  type DomainBanner,
  type DomainEventStep,
} from "@/lib/dashboard/domains"
import { formatDateTime, pluralize } from "@/lib/dashboard/format"
import {
  asDomain,
  useDomainCommands,
  type DnsAutoConfigConflict,
} from "@/lib/domains/use-domains"
import { actionError } from "@/lib/action-error"
import type { Domain, TlsMode } from "@/lib/dashboard/types"
const BANNER_ICON: Record<DomainBanner["tone"], LucideIcon> = {
  success: CircleCheckIcon,
  warning: ClockIcon,
  destructive: CircleAlertIcon,
  default: InfoIcon,
}

/** Optional permissions, on top of the sending policy: only an automatic DNS
    setup in Route 53 needs them. */
const ROUTE53_PERMISSIONS = [
  "route53:ListHostedZonesByName",
  "route53:ListResourceRecordSets",
  "route53:ChangeResourceRecordSets",
]

const CLOUDFLARE_TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens"

const EVENT_ICON: Record<DomainEventStep["type"], LucideIcon> = {
  added: DomainIcon,
  dns_verified: ListChecksIcon,
  partially_verified: CircleCheckIcon,
  verified: BadgeCheckIcon,
}

function DomainStatusAlert({
  domain,
  error,
  onReview,
}: {
  domain: Domain
  error?: string
  onReview?: () => void
}) {
  const banner = domainBanner(domain.status)
  const Icon = error ? CircleAlertIcon : BANNER_ICON[banner.tone]
  return (
    <Alert variant={error ? "destructive" : banner.tone}>
      <Icon />
      <AlertTitle>
        {error ? "Domain setup needs attention" : banner.title}
      </AlertTitle>
      <AlertDescription>
        {error ?? banner.description}
        {onReview && (
          <Button variant="outline" onClick={onReview}>
            Review existing identity
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function IdentityReview({
  domain,
  open,
  onOpenChange,
}: {
  domain: Doc<"domains">
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const preview = useAction(api.ses.adoption.preview)
  const approve = useMutation(api.domains.approveAdoption)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  const adoption =
    domain.adoption && !domain.adoption.approved ? domain.adoption : null
  async function run(operation: () => Promise<unknown>, close = false) {
    setPending(true)
    setError("")
    try {
      await operation()
      if (close) onOpenChange(false)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect existing domain</DialogTitle>
          <DialogDescription>
            Review this domain’s current AWS settings before connecting it.
            Existing DKIM records are preserved.
          </DialogDescription>
        </DialogHeader>
        {adoption && (
          <p className="text-sm">
            Current configuration set: {adoption.configurationSet ?? "None"}
            <br />
            Current MAIL FROM: {adoption.mailFromDomain ?? "Default"}
            <br />
            Opensend will assign its configuration set and use{" "}
            {domain.customReturnPath}.{domain.name} for MAIL FROM. Removing the
            domain restores its previous settings.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void run(() => preview({ id: domain._id }))}
          >
            Review AWS settings
          </Button>
          {adoption && (
            <Button
              disabled={pending || !!error}
              onClick={() =>
                void run(
                  () =>
                    approve({
                      id: domain._id,
                      fingerprint: adoption.fingerprint,
                    }),
                  true
                )
              }
            >
              Approve identity changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <DetailSection title="Domain events">
      <EventTrail steps={steps} />
    </DetailSection>
  )
}

/** Writes the records for you at Cloudflare or Route 53. Cloudflare needs a
    token for the one call; Route 53 rides on the connected AWS account. */
function AutoConfigureDialog({
  domain,
  open,
  onOpenChange,
}: {
  domain: Domain
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { autoConfigureDns } = useDomainCommands()
  const cloudflare = domain.provider === "cloudflare"
  const [token, setToken] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")
  const [conflicts, setConflicts] = React.useState<DnsAutoConfigConflict[]>([])

  /* The token lives no longer than the dialog does. */
  function change(next: boolean) {
    if (!next) {
      setToken("")
      setError("")
      setConflicts([])
    }
    onOpenChange(next)
  }

  async function submit() {
    if (pending) return
    setPending(true)
    setError("")
    try {
      const result = await autoConfigureDns(
        domain.id,
        cloudflare ? token.trim() : undefined
      )
      toast.add({
        type: "success",
        title: `${pluralize(result.created, "record")} added`,
        description: `${result.skipped} already in place`,
      })
      setToken("")
      setConflicts(result.conflicts)
      if (result.conflicts.length === 0) change(false)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Auto configure DNS</DialogTitle>
          <DialogDescription>
            {cloudflare
              ? `Opensend adds the records for ${domain.name} to its Cloudflare zone.`
              : `Opensend adds the records for ${domain.name} to its Route 53 hosted zone, using the AWS account this installation is connected to.`}{" "}
            A record that already exists is never overwritten.
          </DialogDescription>
        </DialogHeader>
        {conflicts.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              These records hold another value already. Update them at{" "}
              {providerLabel(domain.provider)} yourself.
            </p>
            <ul className="flex flex-col gap-1">
              {conflicts.map((conflict) => (
                <li
                  key={`${conflict.type}-${conflict.name}`}
                  className="text-sm text-muted-foreground"
                >
                  <MonoValue copyValue={conflict.name}>
                    {conflict.name}
                  </MonoValue>{" "}
                  {conflict.type} — {conflict.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : cloudflare ? (
          <Field>
            <FieldLabel htmlFor="cloudflare-token">
              Cloudflare API token
            </FieldLabel>
            <Input
              id="cloudflare-token"
              type="password"
              autoComplete="off"
              disabled={pending}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <FieldDescription>
              <a href={CLOUDFLARE_TOKEN_URL} target="_blank" rel="noreferrer">
                Create a token
              </a>{" "}
              with Zone → DNS → Edit. It is used for this one call and never
              stored.
            </FieldDescription>
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Your AWS user needs these permissions, which are optional
              everywhere else:
            </p>
            <ul className="flex flex-col gap-1">
              {ROUTE53_PERMISSIONS.map((permission) => (
                <li key={permission}>
                  <MonoValue copyValue={permission}>{permission}</MonoValue>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {conflicts.length > 0 ? "Done" : "Cancel"}
          </DialogClose>
          {conflicts.length === 0 && (
            <Button
              disabled={pending || (cloudflare && token.trim() === "")}
              onClick={() => void submit()}
            >
              Add records
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DomainRecords({
  domain,
  busy,
  installationAdmin,
}: {
  domain: Domain
  busy: boolean
  installationAdmin: boolean
}) {
  const { canWrite, updateDomain, verifyDomain } = useDomainCommands()
  const [pending, setPending] = React.useState(false)
  const [autoOpen, setAutoOpen] = React.useState(false)
  const records = domainRecords(domain)
  const sections = domainRecordSections(domain, records)
  const canAuto = canAutoConfigure(domain.provider)
  const locked = !canWrite || busy || pending
  // Route 53 writes ride on the installation's AWS account, not the caller's.
  const blockedReason = !canAuto
    ? `Automatic DNS setup is available for Cloudflare and Route 53. Add the records at ${
        domain.provider && domain.provider !== "other"
          ? providerLabel(domain.provider)
          : "your DNS provider"
      } manually.`
    : domain.provider === "route53" && !installationAdmin
      ? "Ask an installation admin — Route 53 setup uses the connected AWS account."
      : ""

  async function runVerification() {
    if (pending || busy) return
    setPending(true)
    try {
      await verifyDomain(domain.id)
      toast.add({ type: "success", title: "DNS check queued" })
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(false)
    }
  }

  const autoConfigureButton = (
    <Button
      variant="outline"
      disabled={!!blockedReason || locked}
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
        <div className="flex flex-wrap items-center gap-2">
          {blockedReason ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {autoConfigureButton}
              </TooltipTrigger>
              <TooltipContent>{blockedReason}</TooltipContent>
            </Tooltip>
          ) : (
            autoConfigureButton
          )}
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => void runVerification()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Check DNS records
          </Button>
          <MoreMenu>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() =>
                  void copyToClipboard(
                    domainZoneFile(domain, records),
                    "Records"
                  )
                }
              >
                <CopyIcon />
                Copy all records
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => downloadZoneFile(domain, records)}
              >
                <DownloadIcon />
                Download zone file
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  downloadTextFile(
                    `${domain.name}-dns.csv`,
                    domainCsvFile(domain, records)
                  )
                }
              >
                <DownloadIcon />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MoreMenu>
        </div>
      </div>
      {sections.map((section, index) => {
        const toggle = section.toggle
        return (
          <DomainSection
            key={section.id}
            title={section.title}
            description={section.description}
            docLabel={section.enabled ? section.docLabel : undefined}
            divider={index > 0}
            toggle={
              toggle
                ? {
                    checked: section.enabled,
                    disabled: locked,
                    onCheckedChange: (checked) => {
                      void updateDomain(
                        domain.id,
                        toggle === "sending"
                          ? { sending: checked }
                          : { receiving: checked }
                      ).catch((error) =>
                        toast.add({ type: "error", title: actionError(error) })
                      )
                    },
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
        )
      })}
      <AutoConfigureDialog
        domain={domain}
        open={autoOpen}
        onOpenChange={setAutoOpen}
      />
    </Surface>
  )
}

function DomainConfiguration({
  domain,
  busy,
}: {
  domain: Domain
  busy: boolean
}) {
  const { canWrite, updateDomain } = useDomainCommands()
  const tracking = trackingEnabled(domain)
  const trackingRecords = domainTrackingRecords(domain)

  return (
    <Surface>
      <h2 className="text-base font-medium">Configuration</h2>
      <DomainSection
        title="Enable tracking metrics"
        description="To track clicks and email opens, set up a custom tracking subdomain. Tracked links then match your sending domain, which improves deliverability."
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
          <Button
            variant="outline"
            disabled
            title="Tracking is not available yet"
          >
            Configure
          </Button>
        </div>
      </DomainSection>
      <DomainSection
        divider
        title="TLS (Transport Layer Security)"
        description={`"Opportunistic TLS" always tries a secure connection to the receiving mail server. If it can't make one, it sends the message unencrypted. "Enforced TLS" requires TLS for every message.`}
      >
        <OptionSelect
          id="domain-tls"
          className="w-full sm:max-w-56"
          aria-label="TLS"
          value={domain.tls}
          disabled={!canWrite || busy}
          onChange={(next) => {
            void updateDomain(domain.id, { tls: next as TlsMode }).catch(
              (error) => toast.add({ type: "error", title: actionError(error) })
            )
          }}
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
    </Surface>
  )
}

export function DomainDetail() {
  const { id } = useParams<{ id: string }>()
  const result = useQuery(api.domains.get, { id })
  const installation = useQuery(api.installation.status)
  const complete = useMutation(api.installation.complete)
  const inspectProvider = useAction(api.ses.dnsProvider.inspect)
  const { deleteDomain, canWrite } = useDomainCommands()
  const { leaving, deleteAndLeave } = useDeleteRecord("/domains")
  const [tab, setTab] = React.useState("records")
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const [providerLookupFailed, setProviderLookupFailed] = React.useState(false)
  const stored = result?.domain
  const domain = React.useMemo(
    () => (stored ? asDomain(stored) : undefined),
    [stored]
  )
  const providerDomainId = stored?._id
  const providerCheckedAt = stored?.dnsProviderCheckedAt
  React.useEffect(() => {
    // The server claim is the backstop; don't ask again while it is fresh.
    if (
      providerDomainId &&
      (!providerCheckedAt || Date.now() - providerCheckedAt > 3600000)
    )
      void inspectProvider({ id: providerDomainId })
        .then(() => setProviderLookupFailed(false))
        .catch(() => setProviderLookupFailed(true))
  }, [providerDomainId, providerCheckedAt, inspectProvider])
  // Resume installations that added their domain before setup completion moved here.
  React.useEffect(() => {
    if (
      installation?.admin &&
      !installation.installation?.completedAt &&
      result?.tenant?.phase === "ready"
    )
      void complete({ organizationId: result.domain.organizationId }).catch(
        (error) => toast.add({ type: "error", title: actionError(error) })
      )
  }, [
    installation?.admin,
    installation?.installation?.completedAt,
    result?.tenant?.phase,
    result?.domain.organizationId,
    complete,
  ])
  if (result === undefined) return <Skeleton className="h-64 w-full" />
  if (!result || !domain) {
    if (leaving) return null
    return <NotFoundState icon={DomainIcon} noun="domain" backHref="/domains" />
  }
  const busy = result.domain.phase === "running"
  const error = result.domain.error ?? result.tenant?.error
  // The worker flags an identity it could not claim; error text is never parsed.
  const reviewable =
    installation?.admin &&
    result.domain.phase === "failed" &&
    result.domain.operation === "provision" &&
    (!!result.domain.adoption || !!result.domain.needsAdoptionReview)
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
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!canWrite || busy}
                  onClick={() => setPendingDelete(true)}
                >
                  <Trash2Icon />
                  Delete domain
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />
      <MetaStrip
        items={[
          { label: "Created", value: <RelativeTime at={domain.createdAt} /> },
          { label: "Status", value: <StatusBadge status={domain.status} /> },
          {
            label: "Provider",
            value: result.domain.dnsProviderCheckedAt ? (
              <ProviderValue domain={domain} />
            ) : providerLookupFailed ? (
              "Unavailable"
            ) : (
              "Checking…"
            ),
          },
          { label: "Region", value: <RegionValue domain={domain} /> },
        ]}
      />
      <DomainStatusAlert
        domain={domain}
        error={error}
        onReview={reviewable ? () => setReviewOpen(true) : undefined}
      />
      <DomainEvents domain={domain} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "records" ? (
        <DomainRecords
          domain={domain}
          busy={busy}
          installationAdmin={!!installation?.admin}
        />
      ) : (
        <DomainConfiguration domain={domain} busy={busy} />
      )}
      <IdentityReview
        domain={result.domain}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />
      <DomainsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${domain.name}?`}
        description="Sending from this domain will stop. DNS records can stay at your registrar."
        onConfirm={async () => {
          await deleteDomain(domain.id)
          deleteAndLeave(() => {})
          toast.add({ type: "success", title: "Domain removal queued" })
        }}
      />
    </div>
  )
}
