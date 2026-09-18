"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import {
  ChartLineIcon,
  FlaskConicalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Observability } from "@/components/dashboard/automations/observability"
import {
  AutomationIcon,
  AutomationMenu,
  STEP_ICONS,
  useToggleAutomation,
} from "@/components/dashboard/automations/shared"
import {
  StepCard,
  TriggerCard,
} from "@/components/dashboard/automations/step-cards"
import { WorkflowCanvas } from "@/components/dashboard/automations/workflow"
import { EditorNotFound } from "@/components/dashboard/broadcasts/editor/screen"
import { EditorRail, EditorTopBar } from "@/components/dashboard/editor-chrome"
import {
  AutomationStatusBadge,
  ConfirmDialog,
  OptionSelect,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import {
  insertStep,
  newStep,
  payloadErrors,
  removeStep,
  replaceStep,
  samplePayload,
  STEP_GROUPS,
  STEP_LABELS,
  stepBranches,
  TRIGGER_KEY,
  type AutomationTask,
} from "@/lib/dashboard/automation"
import { useDashboard, useStoreHydrated } from "@/lib/dashboard/store"
import type {
  Automation,
  AutomationStep,
  AutomationStepType,
} from "@/lib/dashboard/types"

/* Full-screen builder, in the same frame as the email editor: a top bar, a
   rail that switches between editing and observability, and the canvas. */

const VIEW_ITEMS = [
  { value: "editor" as const, label: "Editor", icon: PencilIcon },
  {
    value: "observability" as const,
    label: "Observability",
    icon: ChartLineIcon,
  },
]

type BuilderView = (typeof VIEW_ITEMS)[number]["value"]

function AddStep({ onAdd }: { onAdd: (type: AutomationStepType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full bg-card"
            aria-label="Add step"
            data-testid="workflow-add-step"
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56">
        {STEP_GROUPS.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.types.map((type) => {
              const Icon = STEP_ICONS[type]
              return (
                <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
                  <Icon />
                  {STEP_LABELS[type]}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AutomationBuilder() {
  const { id } = useParams<{ id: string }>()
  const { state } = useDashboard()
  const hydrated = useStoreHydrated()
  const { leaving, deleteAndLeave } = useDeleteRecord("/automations")
  const automation = state.automations.find((item) => item.id === id)

  if (!hydrated) return null
  if (!automation) {
    if (leaving) return null
    return (
      <EditorNotFound
        icon={AutomationIcon}
        noun="automation"
        backHref="/automations"
      />
    )
  }
  return (
    <BuilderScreen
      key={automation.id}
      automation={automation}
      deleteAndLeave={deleteAndLeave}
    />
  )
}

function BuilderScreen({
  automation,
  deleteAndLeave,
}: {
  automation: Automation
  deleteAndLeave: (remove: () => void) => void
}) {
  const { state, updateAutomation, deleteAutomation } = useDashboard()
  const toggle = useToggleAutomation()
  const [view, setView] = React.useState<BuilderView>("editor")
  /* The card showing its settings: the trigger, or a step by key. A blank
     automation opens on its trigger. */
  const [selected, setSelected] = React.useState<string | null>(
    automation.trigger ? null : TRIGGER_KEY
  )
  const [tasks, setTasks] = React.useState<AutomationTask[] | null>(null)
  const startRef = React.useRef<HTMLButtonElement>(null)
  const [testing, setTesting] = React.useState(false)
  const [removing, setRemoving] = React.useState<AutomationStep | null>(null)

  const enabled = automation.status === "enabled"
  const setSteps = (steps: AutomationStep[]) =>
    updateAutomation(automation.id, { steps })
  const select = (key: string) =>
    setSelected((current) => (current === key ? null : key))

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <EditorTopBar
        noun="automation"
        listHref="/automations"
        listLabel="Automations"
        name={automation.name}
        onRename={(name) => updateAutomation(automation.id, { name })}
        badge={<AutomationStatusBadge status={automation.status} />}
      >
        <AutomationMenu
          automation={automation}
          inDetail
          onDelete={() => deleteAndLeave(() => deleteAutomation(automation.id))}
        >
          <DropdownMenuItem
            data-testid="automation-test"
            onClick={() => {
              if (enabled) setTesting(true)
              else {
                toast.add({
                  type: "error",
                  title: "Start the automation before testing it.",
                })
              }
            }}
          >
            <FlaskConicalIcon />
            Test event
          </DropdownMenuItem>
        </AutomationMenu>
        <Button
          ref={startRef}
          size="sm"
          variant={enabled ? "outline" : "default"}
          data-testid="automation-toggle"
          onClick={() => {
            const left = toggle(automation)
            setTasks(left.length > 0 ? left : null)
            if (left.length === 0 && !enabled) setSelected(null)
          }}
        >
          {enabled ? "Stop" : "Start"}
        </Button>
        {/* Opens under the button when a start is refused, to say why. */}
        <Popover
          open={tasks !== null}
          onOpenChange={(open) => {
            if (!open) setTasks(null)
          }}
        >
          <PopoverContent align="end" anchor={startRef} className="w-80">
            <PopoverHeader>
              <PopoverTitle>Tasks remaining to start automation</PopoverTitle>
            </PopoverHeader>
            <ul className="flex flex-col gap-3" data-testid="automation-tasks">
              {(tasks ?? []).map((item) => {
                const Icon = STEP_ICONS[item.type]
                return (
                  <li key={item.key} className="flex gap-3">
                    <span className="icon-tile size-8 rounded-lg [&_svg]:size-4">
                      <Icon />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{item.title}</span>
                      <ul className="list-inside list-disc text-caption text-muted-foreground">
                        {item.tasks.map((task) => (
                          <li key={task}>{task}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      </EditorTopBar>

      <div className="flex min-h-0 flex-1">
        <EditorRail
          label="Automation view"
          value={view}
          items={VIEW_ITEMS}
          testIdPrefix="view-toggle"
          onValueChange={setView}
        />
        <main className="flex min-w-0 flex-1 flex-col p-3">
          {view === "observability" ? (
            <Observability automation={automation} />
          ) : (
            <WorkflowCanvas
              steps={automation.steps}
              trigger={
                <TriggerCard
                  automation={automation}
                  selected={selected === TRIGGER_KEY}
                  locked={enabled}
                  onSelect={() => select(TRIGGER_KEY)}
                  onChange={(trigger) => {
                    updateAutomation(automation.id, { trigger })
                    setSelected(null)
                  }}
                />
              }
              renderAdd={
                enabled
                  ? undefined
                  : (slot) => (
                      <AddStep
                        onAdd={(type) => {
                          const step = newStep(
                            type,
                            automation.steps,
                            /* Steps its runs still name keep their keys. */
                            state.automationRuns
                              .filter(
                                (run) => run.automationId === automation.id
                              )
                              .flatMap((run) =>
                                run.steps.map((done) => done.key)
                              )
                          )
                          setSteps(insertStep(automation.steps, slot, step))
                          setSelected(step.key)
                        }}
                      />
                    )
              }
              renderStep={(step) => (
                <StepCard
                  automation={automation}
                  step={step}
                  selected={selected === step.key}
                  locked={enabled}
                  onSelect={() => select(step.key)}
                  onChange={(next) =>
                    setSteps(replaceStep(automation.steps, next))
                  }
                  onRemove={() => setRemoving(step)}
                />
              )}
            />
          )}
        </main>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Remove this step?"
        description={
          removing && stepBranches(removing).length > 0
            ? "The steps on both of its paths are removed with it."
            : "The steps around it join up."
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) setSteps(removeStep(automation.steps, removing.key))
        }}
      />
      <TestEventDialog
        open={testing}
        onOpenChange={setTesting}
        automation={automation}
        onSent={() => setView("observability")}
      />
    </div>
  )
}

function TestEventDialog({
  open,
  onOpenChange,
  automation,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  automation: Automation
  onSent: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted per opening, so the payload starts from the event's schema. */}
      {open ? (
        <TestEventForm
          automation={automation}
          onDone={() => {
            onOpenChange(false)
            onSent()
          }}
        />
      ) : null}
    </Dialog>
  )
}

function TestEventForm({
  automation,
  onDone,
}: {
  automation: Automation
  onDone: () => void
}) {
  const { state, runAutomation } = useDashboard()
  const event = state.automationEvents.find(
    (item) => item.name === automation.trigger
  )
  const [contactId, setContactId] = React.useState(state.contacts[0]?.id ?? "")
  const [payload, setPayload] = React.useState(() =>
    JSON.stringify(samplePayload(event), null, 2)
  )
  const [error, setError] = React.useState<string | null>(null)

  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={(submitted) => {
          submitted.preventDefault()
          let parsed: unknown
          try {
            parsed = JSON.parse(payload || "{}")
          } catch {
            setError("The payload is not valid JSON")
            return
          }
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            setError("The payload is a JSON object")
            return
          }
          const body = parsed as Record<string, unknown>
          const [problem] = payloadErrors(event, body)
          if (problem) {
            setError(`Rejected with 422: ${problem}`)
            return
          }
          if (!runAutomation(automation.id, { contactId, payload: body })) {
            setError("Choose a contact")
            return
          }
          toast.add({ type: "success", title: "Event sent" })
          onDone()
        }}
      >
        <DialogHeader>
          <DialogTitle>Test event</DialogTitle>
          <DialogDescription>
            Sends {automation.trigger} for one contact and starts a run.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="test-contact">Contact</FieldLabel>
            <OptionSelect
              id="test-contact"
              className="w-full"
              value={contactId}
              onChange={setContactId}
              items={state.contacts.map((contact) => ({
                value: contact.id,
                label: contact.email,
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="test-payload">Payload</FieldLabel>
            <Textarea
              id="test-payload"
              value={payload}
              rows={6}
              className="font-mono text-[13px]"
              onChange={(changed) => {
                setPayload(changed.target.value)
                setError(null)
              }}
            />
            <FieldDescription>
              It is checked against the event&rsquo;s properties.
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" data-testid="test-event-send">
            Send event
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
