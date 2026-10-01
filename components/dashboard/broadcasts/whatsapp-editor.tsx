"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  useWorkspace,
  requireTeamId,
  useTeamQuery,
} from "@/components/auth/workspace"
import { EditorTopBar } from "@/components/dashboard/editor-chrome"
import {
  BroadcastStatusBadge,
  SettingsCard,
  OptionSelect,
} from "@/components/dashboard/primitives"
import {
  WhatsAppCampaignFields,
  type WhatsAppCampaignConfig,
} from "@/components/dashboard/whatsapp-campaign-fields"
import { WhenField } from "@/components/dashboard/broadcasts/editor/header-form"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { useSegmentOptions, useTopicOptions } from "@/lib/audience/use-audience"
import { useBroadcastCommands } from "@/lib/broadcasts/use-broadcasts"
import type { Broadcast } from "@/lib/dashboard/types"
import { actionError } from "@/lib/action-error"
import { formatScheduleHint } from "@/lib/dashboard/schedule"

export function WhatsAppBroadcastEditor({ item }: { item: Broadcast }) {
  const router = useRouter()
  const commands = useBroadcastCommands()
  const { activeTeamId } = useWorkspace()
  const [config, setConfig] = React.useState<WhatsAppCampaignConfig>(
    item.whatsapp ?? { accountId: "", templateId: "", variables: {} }
  )
  const [segmentId, setSegmentId] = React.useState(item.segmentId)
  const [topicId, setTopicId] = React.useState(item.topicId)
  const [sendAt, setSendAt] = React.useState<number | null>(item.scheduledAt)
  const [segmentSearch, setSegmentSearch] = React.useState("")
  const [topicSearch, setTopicSearch] = React.useState("")
  const segments = useSegmentOptions(segmentId, segmentSearch) ?? []
  const topics = useTopicOptions(topicId, topicSearch) ?? []
  const sample = useTeamQuery(api.broadcastWhatsApp.sampleContact, {
    id: item.id as Id<"broadcasts">,
    segmentId: segmentId as Id<"segments"> | null,
    topicId: topicId as Id<"topics"> | null,
  })
  const review = useAction(api.broadcastWhatsApp.review)
  const [estimate, setEstimate] = React.useState<{
    recipients: number
    skipped: number
    noPhone: number
  } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const reportError = (error: unknown) =>
    toast.add({ type: "error", title: actionError(error) })
  async function save() {
    if (!config.accountId || !config.templateId)
      throw new Error("Select a sending number and an approved template")
    await commands.updateBroadcast(item.id, {
      segmentId,
      topicId,
      whatsapp: {
        accountId: config.accountId,
        templateId: config.templateId,
        variables: config.variables,
      },
    })
  }
  async function reviewSend() {
    setBusy(true)
    try {
      await save()
      setEstimate(
        await review({
          organizationId: requireTeamId(activeTeamId),
          id: item.id as Id<"broadcasts">,
        })
      )
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }
  async function send() {
    setBusy(true)
    try {
      await commands.sendBroadcast(item.id, sendAt ?? undefined)
      toast.add({
        type: "success",
        title: sendAt ? "Broadcast scheduled" : "Broadcast queued",
      })
      router.push(`/broadcasts/${item.id}`)
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorTopBar
        noun="broadcast"
        listHref="/broadcasts"
        listLabel="Broadcasts"
        name={item.name}
        onRename={(name) =>
          void commands.updateBroadcast(item.id, { name }).catch(reportError)
        }
        badge={<BroadcastStatusBadge status={item.status} />}
      >
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void save()
              .then(() => toast.add({ type: "success", title: "Draft saved" }))
              .catch(reportError)
              .finally(() => setBusy(false))
          }}
        >
          Save
        </Button>
        <Button
          data-testid="whatsapp-broadcast-review"
          disabled={busy}
          onClick={() => void reviewSend()}
        >
          Review
        </Button>
      </EditorTopBar>
      <main
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6"
        data-testid="whatsapp-broadcast-form"
      >
        <Alert>
          <AlertDescription>
            Meta charges per delivered template message by category
          </AlertDescription>
        </Alert>
        <SettingsCard
          title="WhatsApp message"
          description="Send an approved template from your connected number."
        >
          <WhatsAppCampaignFields
            config={config}
            onChange={setConfig}
            sample={sample}
          />
        </SettingsCard>
        <SettingsCard title="Audience and schedule">
          <FieldGroup>
            <Field>
              <FieldLabel>Audience</FieldLabel>
              <OptionSelect
                aria-label="Audience"
                value={segmentId ?? "everyone"}
                search={{ onChange: setSegmentSearch }}
                items={[
                  { value: "everyone", label: "All contacts" },
                  ...segments.map((segment) => ({
                    value: segment.id,
                    label: segment.name,
                  })),
                ]}
                onChange={(value) =>
                  setSegmentId(value === "everyone" ? null : value)
                }
              />
            </Field>
            <Field>
              <FieldLabel>Topic</FieldLabel>
              <OptionSelect
                aria-label="Topic"
                value={topicId ?? "none"}
                search={{ onChange: setTopicSearch }}
                items={[
                  { value: "none", label: "No topic" },
                  ...topics.map((topic) => ({
                    value: topic.id,
                    label: topic.name,
                  })),
                ]}
                onChange={(value) =>
                  setTopicId(value === "none" ? null : value)
                }
              />
            </Field>
            <Field>
              <FieldLabel>When</FieldLabel>
              <WhenField
                paper={false}
                sendAt={sendAt}
                onSendAtChange={setSendAt}
              />
            </Field>
          </FieldGroup>
        </SettingsCard>
      </main>
      <Dialog
        open={estimate !== null}
        onOpenChange={(open) => {
          if (!open) setEstimate(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review WhatsApp broadcast</DialogTitle>
            <DialogDescription>
              {sendAt ? formatScheduleHint(sendAt) : "Send now"}
            </DialogDescription>
          </DialogHeader>
          {estimate ? (
            <div data-testid="whatsapp-broadcast-estimate">
              <p>
                {estimate.recipients.toLocaleString()} recipients,{" "}
                {estimate.skipped.toLocaleString()} skipped
              </p>
              <p>
                {estimate.noPhone.toLocaleString()} skipped for lacking a phone
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstimate(null)}>
              Back
            </Button>
            <Button
              disabled={busy || !estimate?.recipients}
              onClick={() => void send()}
            >
              {sendAt ? "Schedule broadcast" : "Send broadcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
