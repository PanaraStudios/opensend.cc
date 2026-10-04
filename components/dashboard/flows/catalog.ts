import type { ComponentType, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export type FlowSlot = {
  parent: { key: string; branch: string } | null
  index: number
}
export type FlowBranch<Node> = {
  id: string
  label?: string
  steps: readonly Node[]
}
export type FlowPresentation = {
  icon: LucideIcon
  title: string
  summary: string | null
}
export type FlowNodeProps<Node, Context> = {
  node: Node
  context: Context
  selected: boolean
  onSelect: () => void
}
export type FlowNodeKind<Node, Context, Kind extends string = string> = {
  icon: LucideIcon
  label: string
  summary: (node: Node, context: Context) => string | null
  branches: (node: Node) => readonly FlowBranch<Node>[]
  /** Kinds allowed at the next insertion point; an empty list is terminal. */
  addAfter: (node: Node) => readonly Kind[]
  Editor: ComponentType<FlowNodeProps<Node, Context>>
  /** Existing consumers can keep editing inline on the selected card. */
  Card?: ComponentType<
    FlowNodeProps<Node, Context> & {
      editor: ReactNode
      presentation: FlowPresentation
    }
  >
  title?: (node: Node, context: Context) => string
  selectKey?: (node: Node, context: Context) => string
}
export type FlowCatalog<Node, Context, Kind extends string = string> = {
  kind: (node: Node) => Kind
  entries: Record<Kind, FlowNodeKind<Node, Context, Kind>>
}
