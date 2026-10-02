"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CirclePauseIcon,
  CirclePlayIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  GitBranchIcon,
  HourglassIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPenIcon,
  UsersIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"

import { channelIcon } from "@/components/dashboard/channels/shared"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  MoreMenu,
  SectionChrome,
  TextFieldDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { automationStatusLabel } from "@/lib/dashboard/format"
import type { AutomationTask } from "@/lib/dashboard/automation"
import { AUTOMATION_TABS } from "@/lib/dashboard/nav"
import { useAutomationCommands } from "@/lib/automations/use-automations"
import { actionError } from "@/lib/action-error"
import type { Automation, AutomationRunStep } from "@/lib/dashboard/types"

export const AutomationIcon = WorkflowIcon
export const EventIcon = ZapIcon

export const STEP_ICONS: Record<AutomationRunStep["type"], LucideIcon> = {
  trigger: EventIcon,
  condition: GitBranchIcon,
  delay: ClockIcon,
  wait_for_event: HourglassIcon,
  send_email: SendIcon,
  send_whatsapp: channelIcon("whatsapp") as LucideIcon,
  send_messenger: channelIcon("messenger") as LucideIcon,
  send_instagram: channelIcon("instagram") as LucideIcon,
  contact_update: UserPenIcon,
  contact_delete: UserMinusIcon,
  add_to_segment: UsersIcon,
}

export const AUTOMATION_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...(["enabled", "disabled"] as const).map((value) => ({
    value,
    label: automationStatusLabel(value),
  })),
]

export function AutomationsChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SectionChrome title="Automations" tabs={AUTOMATION_TABS} actions={actions}>
      {children}
    </SectionChrome>
  )
}

/** Starts the automation, or says what is left to do first. Stopping always
    works. Returns the tasks that blocked a start, for the caller to show. */
export function useToggleAutomation() {
  const { setAutomationStatus } = useAutomationCommands()
  return async (automation: Automation): Promise<AutomationTask[]> => {
    if (automation.status === "enabled") {
      await setAutomationStatus(automation.id, "disabled")
      toast.add({
        type: "success",
        title: "Automation stopped",
        description: "No new runs start. Runs in flight finish.",
      })
      return []
    }
    const tasks = await setAutomationStatus(automation.id, "enabled")
    if (tasks.length > 0) return tasks
    toast.add({ type: "success", title: "Automation started" })
    return []
  }
}

export function AutomationMenu({
  automation,
  inDetail = false,
  onDelete,
  children,
}: {
  automation: Automation
  inDetail?: boolean
  /** Replaces the plain delete, for a page that has to leave first. */
  onDelete?: () => void | Promise<void>
  /** Items only that page has, listed first. */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const { updateAutomation, duplicateAutomation, deleteAutomation } =
    useAutomationCommands()
  const toggle = useToggleAutomation()
  const [renaming, setRenaming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const enabled = automation.status === "enabled"

  return (
    <>
      <MoreMenu>
        <DropdownMenuGroup>
          {children}
          {/* The editor names the automation in its top bar, and starts and
              stops it from there. */}
          {inDetail ? null : (
            <>
              <DropdownMenuItem
                render={<Link href={`/automations/${automation.id}`} />}
              >
                <EyeIcon />
                Open automation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilIcon />
                Rename automation
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem
            onClick={async () => {
              try {
                const copy = await duplicateAutomation(automation.id)
                toast.add({ type: "success", title: "Automation duplicated" })
                router.push(`/automations/${copy.id}`)
              } catch (error) {
                toast.add({ type: "error", title: actionError(error) })
              }
            }}
          >
            <CopyIcon />
            Duplicate automation
          </DropdownMenuItem>
          {inDetail ? null : (
            <DropdownMenuItem
              onClick={async () => {
                try {
                  if ((await toggle(automation)).length === 0) return
                  toast.add({
                    type: "error",
                    title: "Not ready to start",
                    description:
                      "Open the automation to see what is left to do.",
                  })
                } catch (error) {
                  toast.add({ type: "error", title: actionError(error) })
                }
              }}
            >
              {enabled ? <CirclePauseIcon /> : <CirclePlayIcon />}
              {enabled ? "Disable automation" : "Enable automation"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon />
            Delete automation
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </MoreMenu>
      <TextFieldDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename automation"
        description="Contacts never see this name."
        label="Name"
        value={automation.name}
        validate={(value) => (value ? null : "Enter a name")}
        onSubmit={async (value) => {
          await updateAutomation(automation.id, { name: value })
          toast.add({ type: "success", title: "Automation renamed" })
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete automation?"
        description="Runs in flight stop, and the run history is removed."
        onConfirm={async () => {
          if (onDelete) await onDelete()
          else await deleteAutomation(automation.id)
          toast.add({ type: "success", title: "Automation deleted" })
        }}
      />
    </>
  )
}
