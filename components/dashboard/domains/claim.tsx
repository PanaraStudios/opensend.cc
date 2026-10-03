"use client"
import * as React from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { CircleCheckIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DetailHeader,
  Surface,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import { DnsRecordsTable, DomainSection } from "./shared"
import { channelIcon } from "@/components/dashboard/channels/shared"
import { useDomainCommands } from "@/lib/domains/use-domains"
import { actionError } from "@/lib/action-error"
import { formatDateTime } from "@/lib/dashboard/format"

export function DomainClaim({ domain }: { domain: Doc<"domains"> }) {
  const claim = useQuery(api.domainClaims.get, {
    organizationId: domain.organizationId,
    id: domain._id,
  })
  const verify = useMutation(api.domainClaims.verify)
  const create = useMutation(api.domainClaims.create)
  const { deleteDomain, canWrite } = useDomainCommands()
  const { deleteAndLeave } = useDeleteRecord("/channels")
  const [pending, setPending] = React.useState(false)
  const [cancel, setCancel] = React.useState(false)
  async function check() {
    setPending(true)
    try {
      if (claim?.status === "expired") {
        const next = await create({
          organizationId: domain.organizationId,
          trackingSubdomain: domain.trackingSubdomain,
          openTracking: domain.openTracking,
          clickTracking: domain.clickTracking,
          name: domain.name,
          region: domain.region,
          customReturnPath: domain.customReturnPath,
        })
        window.location.assign(`/domains/${next.domain_id}`)
      } else {
        await verify({ organizationId: domain.organizationId, id: domain._id })
        toast.add({
          type: "success",
          title: "Checking domain ownership",
          description:
            "The claim status will update when verification finishes.",
        })
      }
    } catch (error) {
      toast.add({ type: "error", title: actionError(error) })
    } finally {
      setPending(false)
    }
  }
  if (claim === undefined) return <Skeleton className="h-64 w-full" />
  const transferring = claim?.status === "verified"
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/channels"
        backLabel="Channels"
        title={domain.name}
        icon={channelIcon("email")}
        badge={
          <Badge variant="secondary" className="capitalize">
            {claim?.status ?? "Unavailable"}
          </Badge>
        }
        actions={
          <Button
            variant="outline"
            disabled={!canWrite || transferring || pending}
            onClick={() => setCancel(true)}
          >
            Cancel claim
          </Button>
        }
      />
      {claim && (
        <Surface className="flex flex-col gap-5 p-5">
          {/* Resend's claim step: warning, the TXT record, then the check. */}
          <DomainSection
            title="Claim domain"
            description="Add the DNS record below to verify ownership"
            docLabel="How to add records"
          >
            <Alert variant="warning">
              <AlertDescription>
                {claim.failure_reason ??
                  (claim.status === "expired" ? (
                    "This claim expired. Start a new claim and replace the TXT record."
                  ) : transferring ? (
                    "Ownership verified. The domain is being released from the previous team and set up for yours."
                  ) : (
                    <>
                      <strong className="font-medium text-foreground">
                        {domain.name}
                      </strong>{" "}
                      is in use by another team. Verifying ownership will
                      transfer the domain to your team and revoke their access.
                    </>
                  ))}
              </AlertDescription>
            </Alert>
          </DomainSection>
          <DomainSection
            title="Domain verification"
            description={`This claim expires ${formatDateTime(Date.parse(claim.expires_at))}. After the transfer, add the sending records shown for your team.`}
          >
            <DnsRecordsTable
              domainName={domain.name}
              records={[
                {
                  ...claim.record,
                  id: claim.id,
                  status: transferring ? "verified" : "pending",
                },
              ]}
            />
          </DomainSection>
          <Button
            className="self-start"
            disabled={
              !canWrite || pending || (transferring && !claim.failure_reason)
            }
            onClick={() => void check()}
          >
            {claim.status === "expired" || claim.failure_reason ? null : (
              <CircleCheckIcon data-icon="inline-start" />
            )}
            {pending
              ? "Checking…"
              : claim.status === "expired"
                ? "Start new claim"
                : claim.failure_reason
                  ? "Retry verification"
                  : "I've added the records"}
          </Button>
        </Surface>
      )}
      <ConfirmDialog
        open={cancel}
        onOpenChange={setCancel}
        title="Cancel domain claim"
        description="Remove this placeholder domain and cancel its claim? The current owner keeps the domain."
        confirmLabel="Cancel claim"
        onConfirm={() => deleteAndLeave(() => deleteDomain(domain._id))}
      />
    </div>
  )
}
