"use client"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { AsyncForm } from "@/components/auth/ui"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item"
import { REGIONS } from "@/lib/dashboard/types"
import type { SesStatus } from "./connection-form"

export function SesRegions({
  status,
  settings = false,
}: {
  status: SesStatus
  settings?: boolean
}) {
  const provision = useMutation(api.installation.provisionRegion)
  return (
    <div className="flex flex-col gap-3">
      {status.regions.map((region) => (
        <div key={region._id} className="flex flex-col gap-2">
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>
                {REGIONS.find((item) => item.value === region.region)?.label ??
                  region.region}
              </ItemTitle>
              <ItemDescription>
                {region.region}
                {region.region === status.installation?.defaultRegion
                  ? " · Default"
                  : ""}
              </ItemDescription>
              <ItemDescription>
                {region.quota.production ? "Production access" : "Sandbox"} ·{" "}
                {region.quota.daily.toLocaleString("en-US")} recipients/day
              </ItemDescription>
              {settings && (
                <ItemDescription>
                  {region.quota.rate.toLocaleString("en-US")}/second · Delivery
                  updates {region.callbackConfirmed ? "connected" : "pending"}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions>
              <Badge
                variant={
                  region.phase === "ready"
                    ? "success"
                    : region.phase === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {region.phase === "ready"
                  ? "Ready"
                  : region.phase === "running"
                    ? "Setting up…"
                    : region.phase === "failed"
                      ? "Needs attention"
                      : "Not set up"}
              </Badge>
            </ItemActions>
          </Item>
          {region.error && (
            <Alert variant="destructive">
              <AlertDescription>{region.error}</AlertDescription>
            </Alert>
          )}
          {settings && status.admin && region.phase !== "ready" && (
            <AsyncForm
              submitLabel={
                region.phase === "failed" ? "Retry setup" : "Set up region"
              }
              disabled={region.phase === "running"}
              success={false}
              onSubmit={() => provision({ region: region.region })}
            />
          )}
        </div>
      ))}
    </div>
  )
}
