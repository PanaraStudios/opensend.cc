"use client"

import * as React from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { WorkflowCanvas, WorkflowCard } from "./workflow"
import type { FlowCatalog, FlowSlot } from "./catalog"

export function useFlowSelection(initial: string | null) {
  const [selected, setSelected] = React.useState(initial)
  const select = (key: string) =>
    setSelected((current) => (current === key ? null : key))
  return { selected, setSelected, select }
}

export function FlowAdd<Node, Context, Kind extends string>({
  catalog,
  groups,
  onAdd,
  disabled,
  footer,
  label = "Add step",
}: {
  catalog: FlowCatalog<Node, Context, Kind>
  groups: readonly { label: string; types: readonly Kind[] }[]
  onAdd: (kind: Kind) => void
  disabled?: (kind: Kind) => boolean
  footer?: React.ReactNode
  label?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full bg-card"
            aria-label={label}
            data-testid="workflow-add-step"
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56">
        {groups.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.types.map((kind) => {
              const entry = catalog.entries[kind]
              const Icon = entry.icon
              const unavailable = disabled?.(kind)
              return (
                <DropdownMenuItem
                  key={kind}
                  disabled={unavailable}
                  onClick={() => onAdd(kind)}
                >
                  <Icon />
                  {entry.label}
                  {unavailable && " — not set up"}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        ))}
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FlowNodeEditor<Node, Context, Kind extends string>({
  catalog,
  node,
  context,
}: {
  catalog: FlowCatalog<Node, Context, Kind>
  node: Node
  context: Context
}) {
  const Editor = catalog.entries[catalog.kind(node)].Editor
  return <Editor node={node} context={context} selected onSelect={() => {}} />
}

export function FlowEditor<
  Node extends { key: string },
  Context,
  Kind extends string,
>({
  catalog,
  context,
  steps,
  trigger,
  selected,
  onSelect,
  renderAdd,
  nodeActions,
  nodeBody,
  problems,
  stacked = false,
}: {
  catalog: FlowCatalog<Node, Context, Kind>
  context: Context
  steps: readonly Node[]
  trigger?: React.ReactNode
  selected: string | null
  onSelect: (key: string) => void
  renderAdd?: (slot: FlowSlot) => React.ReactNode
  nodeActions?: (node: Node) => React.ReactNode
  nodeBody?: (node: Node) => React.ReactNode
  problems?: (node: Node) => readonly string[]
  stacked?: boolean
}) {
  const entry = (node: Node) => catalog.entries[catalog.kind(node)]
  return (
    <WorkflowCanvas
      trigger={trigger}
      startAtFirst={!trigger}
      steps={steps}
      branches={(node) => entry(node).branches(node)}
      terminal={(node) => entry(node).addAfter(node).length === 0}
      stacked={stacked}
      renderAdd={renderAdd}
      renderStep={(node) => {
        const kind = entry(node)
        const props = {
          node,
          context,
          selected: selected === node.key,
          onSelect: () => onSelect(kind.selectKey?.(node) ?? node.key),
        }
        if (kind.Card) {
          const Card = kind.Card
          const Editor = kind.Editor
          return <Card {...props} editor={<Editor {...props} />} />
        }
        const errors = problems?.(node) ?? []
        return (
          <WorkflowCard
            icon={kind.icon}
            title={kind.title?.(node, context) ?? kind.label}
            summary={kind.summary(node, context)}
            tone={errors.length ? "warning" : undefined}
            onSelect={props.onSelect}
            selected={props.selected}
            actions={nodeActions?.(node)}
            data-testid={`workflow-node-${node.key}`}
          >
            {nodeBody?.(node)}
            {errors.length ? (
              <FieldError>{errors.join("; ")}</FieldError>
            ) : null}
          </WorkflowCard>
        )
      }}
    />
  )
}
