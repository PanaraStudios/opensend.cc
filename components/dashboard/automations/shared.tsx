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

import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsCode,
  DocsSheet,
  MoreMenu,
  SectionChrome,
  TextFieldDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  automationTasks,
  type AutomationTask,
} from "@/lib/dashboard/automation"
import { AUTOMATION_TABS } from "@/lib/dashboard/nav"
import { useDashboard } from "@/lib/dashboard/store"
import type { Automation, AutomationRunStep } from "@/lib/dashboard/types"

export const AutomationIcon = WorkflowIcon
export const EventIcon = ZapIcon

export const STEP_ICONS: Record<AutomationRunStep["type"], LucideIcon> = {
  trigger: ZapIcon,
  condition: GitBranchIcon,
  delay: ClockIcon,
  wait_for_event: HourglassIcon,
  send_email: SendIcon,
  contact_update: UserPenIcon,
  contact_delete: UserMinusIcon,
  add_to_segment: UsersIcon,
}

export const AUTOMATION_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
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

const AUTOMATION_DOCS = [
  {
    title: "Trigger",
    body: "Every automation starts with an event your app sends. Each enabled automation listening for that event starts a run for the contact it names.",
  },
  {
    title: "Steps",
    body: "Send a published template, wait for a while or for another event, branch on the event's payload or the contact, and keep the contact up to date.",
  },
  {
    title: "Editing",
    body: "An enabled automation cannot be edited. Duplicate it, change the copy, enable that, then disable the original. Runs in flight finish on the version they started with.",
  },
  {
    title: "Send an event",
    body: (
      <DocsCode>
        {`POST /events
{
  "event": "user.created",
  "email": "ada@example.com",
  "payload": { "plan": "team" }
}`}
      </DocsCode>
    ),
  },
]

export function AutomationsDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Automations"
      description="Emails and contact updates that run themselves when your app sends an event."
      sections={AUTOMATION_DOCS}
    />
  )
}

/** Starts the automation, or says what is left to do first. Stopping always
    works. Returns the tasks that blocked a start, for the caller to show. */
export function useToggleAutomation() {
  const { state, setAutomationStatus } = useDashboard()
  return (automation: Automation): AutomationTask[] => {
    if (automation.status === "enabled") {
      setAutomationStatus(automation.id, "disabled")
      toast.add({
        type: "success",
        title: "Automation stopped",
        description: "No new runs start. Runs in flight finish.",
      })
      return []
    }
    const tasks = automationTasks(automation, state)
    if (tasks.length > 0) return tasks
    setAutomationStatus(automation.id, "enabled")
    toast.add({ type: "success", title: "Automation started" })
    return []
  }
}

export function AutomationMenu({
  automation,
  inDetail = false,
  onDelete,
}: {
  automation: Automation
  inDetail?: boolean
  /** Replaces the plain delete, for a page that has to leave first. */
  onDelete?: () => void
}) {
  const router = useRouter()
  const { updateAutomation, duplicateAutomation, deleteAutomation } =
    useDashboard()
  const toggle = useToggleAutomation()
  const [renaming, setRenaming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const enabled = automation.status === "enabled"

  return (
    <>
      <MoreMenu>
        <DropdownMenuGroup>
          {inDetail ? null : (
            <DropdownMenuItem
              render={<Link href={`/automations/${automation.id}`} />}
            >
              <EyeIcon />
              Open automation
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon />
            Rename automation
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const copy = duplicateAutomation(automation.id)
              if (!copy) return
              toast.add({ type: "success", title: "Automation duplicated" })
              router.push(`/automations/${copy.id}`)
            }}
          >
            <CopyIcon />
            Duplicate automation
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              if (toggle(automation).length === 0) return
              toast.add({
                type: "error",
                title: "Not ready to start",
                description: "Open the automation to see what is left to do.",
              })
            }}
          >
            {enabled ? <CirclePauseIcon /> : <CirclePlayIcon />}
            {enabled ? "Disable automation" : "Enable automation"}
          </DropdownMenuItem>
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
        onSubmit={(value) => {
          updateAutomation(automation.id, { name: value })
          toast.add({ type: "success", title: "Automation renamed" })
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete automation?"
        description="Runs in flight stop, and the run history is removed."
        onConfirm={() => {
          if (onDelete) onDelete()
          else deleteAutomation(automation.id)
          toast.add({ type: "success", title: "Automation deleted" })
        }}
      />
    </>
  )
}
