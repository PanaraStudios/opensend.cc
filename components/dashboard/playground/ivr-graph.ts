import {
  parseIvrAction,
  parseIvrPrompt,
  type IvrAction,
  type IvrDefinition,
  type IvrMenu,
} from "@/lib/ivr"
import type { FlowBranch } from "../flows/catalog"

export type IvrBranchAddress = { menuId: string; branch: string }
export type IvrFlowNode = {
  key: string
  kind: "menu" | IvrAction["kind"]
  menu: IvrMenu
  action?: IvrAction
  address?: IvrBranchAddress
  branches: FlowBranch<IvrFlowNode>[]
}
export const ivrMenuKey = (id: string) => `menu:${id}`
export const ivrActionKey = ({ menuId, branch }: IvrBranchAddress) =>
  `action:${menuId}:${branch}`
export const ivrBranchLabel = (branch: string) =>
  branch === "noInputAction"
    ? "No input"
    : branch === "failureAction"
      ? "Invalid input"
      : `Press ${branch}`
export function ivrMenuBranches(menu: IvrMenu): [string, IvrAction][] {
  return [
    ...Object.entries(menu.options),
    ["noInputAction", menu.noInputAction],
    ["failureAction", menu.failureAction],
  ]
}
export function ivrBranchAction(menu: IvrMenu, branch: string): IvrAction {
  return branch === "noInputAction"
    ? menu.noInputAction
    : branch === "failureAction"
      ? menu.failureAction
      : menu.options[branch]
}
export function setIvrBranch(
  menu: IvrMenu,
  branch: string,
  action: IvrAction
): IvrMenu {
  return branch === "noInputAction"
    ? { ...menu, noInputAction: action }
    : branch === "failureAction"
      ? { ...menu, failureAction: action }
      : { ...menu, options: { ...menu.options, [branch]: action } }
}
export const nextIvrDigit = (menu: IvrMenu) =>
  "1234567890*#".split("").find((digit) => !menu.options[digit])

/** A global visited set (not just ancestors) draws each menu exactly once. */
export function ivrGraph(definition: IvrDefinition) {
  const menus = new Map(definition.menus.map((menu) => [menu.id, menu]))
  const visited = new Set<string>()
  const nodes: IvrFlowNode[] = []
  function draw(menu: IvrMenu, address?: IvrBranchAddress): IvrFlowNode {
    visited.add(menu.id)
    const node: IvrFlowNode = {
      key: ivrMenuKey(menu.id),
      kind: "menu",
      menu,
      address,
      branches: [],
    }
    nodes.push(node)
    node.branches = ivrMenuBranches(menu).map(([branch, action]) => {
      const address = { menuId: menu.id, branch }
      const target =
        action.kind === "submenu" ? menus.get(action.menuId) : undefined
      let child: IvrFlowNode
      if (target && !visited.has(target.id)) child = draw(target, address)
      else {
        child = {
          key: ivrActionKey(address),
          kind: action.kind,
          menu,
          action,
          address,
          branches: [],
        }
        nodes.push(child)
      }
      return { id: branch, label: ivrBranchLabel(branch), steps: [child] }
    })
    return node
  }
  const entry = menus.get(definition.entryMenuId)
  const root = entry ? draw(entry) : undefined
  // Include disconnected cycles too; looking only for unreferenced menus misses them.
  const unreachable = definition.menus.filter((menu) => !visited.has(menu.id))
  return { root, nodes, unreachable }
}

/** All selectable nodes, including incoming paths drawn as full submenus. */
export function ivrEditableNodes(definition: IvrDefinition): IvrFlowNode[] {
  return definition.menus.flatMap((menu) => [
    { key: ivrMenuKey(menu.id), kind: "menu", menu, branches: [] },
    ...ivrMenuBranches(menu).map(([branch, action]): IvrFlowNode => {
      const address = { menuId: menu.id, branch }
      return {
        key: ivrActionKey(address),
        kind: action.kind,
        menu,
        action,
        address,
        branches: [],
      }
    }),
  ])
}

/** Backend reachability includes the business-hours closed destination. */
function unreachableIvrMenus(definition: IvrDefinition): IvrMenu[] {
  const menus = new Map(definition.menus.map((menu) => [menu.id, menu]))
  const visited = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    const menu = menus.get(id)
    if (!menu) return
    visited.add(id)
    for (const [, action] of ivrMenuBranches(menu))
      if (action.kind === "submenu") visit(action.menuId)
  }
  visit(definition.entryMenuId)
  if (definition.businessHours?.closedAction.kind === "submenu")
    visit(definition.businessHours.closedAction.menuId)
  return definition.menus.filter((menu) => !visited.has(menu.id))
}

export function ivrMenuReferences(
  definition: IvrDefinition,
  id: string
): string[] {
  return [
    ...(definition.entryMenuId === id ? ["Entry menu"] : []),
    ...definition.menus.flatMap((menu) =>
      ivrMenuBranches(menu).flatMap(([branch, action]) =>
        action.kind === "submenu" && action.menuId === id
          ? [`${menu.name} · ${ivrBranchLabel(branch)}`]
          : []
      )
    ),
    ...(definition.businessHours?.closedAction.kind === "submenu" &&
    definition.businessHours.closedAction.menuId === id
      ? ["Business hours · When closed"]
      : []),
  ]
}
/** Replace references deliberately, so removing a menu never leaves dangling links. */
export function removeIvrMenu(
  definition: IvrDefinition,
  id: string
): IvrDefinition {
  const replace = (action: IvrAction): IvrAction =>
    action.kind === "submenu" && action.menuId === id
      ? { kind: "hangup" }
      : action
  const menus = definition.menus
    .filter((menu) => menu.id !== id)
    .map((menu) => ({
      ...menu,
      options: Object.fromEntries(
        Object.entries(menu.options).map(([digit, action]) => [
          digit,
          replace(action),
        ])
      ),
      noInputAction: replace(menu.noInputAction),
      failureAction: replace(menu.failureAction),
    }))
  return {
    ...definition,
    menus,
    entryMenuId:
      definition.entryMenuId === id
        ? (menus[0]?.id ?? "")
        : definition.entryMenuId,
    ...(definition.businessHours
      ? {
          businessHours: {
            ...definition.businessHours,
            closedAction: replace(definition.businessHours.closedAction),
          },
        }
      : {}),
  }
}

/** The API returns strings, not paths. Attribute only errors supported by the
 * draft's structure; team ownership/provider errors remain in the summary. */
export function ivrProblemNodes(
  definition: IvrDefinition,
  problems: readonly string[]
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const attach = (key: string, problem: string) =>
    result.set(key, [...(result.get(key) ?? []), problem])
  const nodes = ivrEditableNodes(definition)
  for (const problem of problems) {
    for (const node of nodes) {
      const menu = node.menu
      const indexed = new RegExp(
        `menus\\.${definition.menus.indexOf(menu)}(?![0-9])`
      ).test(problem)
      let relevant = indexed
      if (node.kind === "menu") {
        if (
          /Invalid IVR string/.test(problem) &&
          (!menu.name.trim() ||
            menu.name.length > 256 ||
            /[\0\r\n]/.test(menu.name))
        )
          relevant = true
        for (const prompt of [menu.prompt, menu.invalidPrompt].filter(
          (p) => p !== undefined
        )) {
          try {
            parseIvrPrompt(prompt)
          } catch (e) {
            if (e instanceof Error && problem.includes(e.message))
              relevant = true
          }
          if (prompt.kind === "audio" && /WAV|MP3|OGG|audio/i.test(problem))
            relevant = true
        }
        if (
          /unique DTMF/.test(problem) &&
          (Object.keys(menu.options).length > 12 ||
            Object.keys(menu.options).some((digit) => !/^[0-9*#]$/.test(digit)))
        )
          relevant = true
        if (
          /Expected integer/.test(problem) &&
          (menu.timeoutSeconds < 1 ||
            menu.timeoutSeconds > 30 ||
            !Number.isInteger(menu.timeoutSeconds) ||
            menu.retries < 0 ||
            menu.retries > 5 ||
            !Number.isInteger(menu.retries) ||
            menu.maxDigits < 1 ||
            menu.maxDigits > 12 ||
            !Number.isInteger(menu.maxDigits))
        )
          relevant = true
      } else if (node.action) {
        try {
          parseIvrAction(node.action)
        } catch (e) {
          if (e instanceof Error && problem.includes(e.message)) relevant = true
        }
        if (node.action.kind === "submenu") {
          // A missing target is retained as a selectable link node.
          const target = node.action.menuId
          if (
            !definition.menus.some((m) => m.id === target) &&
            /Dangling menu|Unknown submenu/.test(problem)
          )
            relevant = true
        }
        if (node.action.kind === "bot" && /bot/i.test(problem)) relevant = true
        if (node.action.kind === "webhook" && /Webhook secret/i.test(problem))
          relevant = true
        if (
          node.action.kind === "playAndHangup" &&
          node.action.prompt.kind === "audio" &&
          /WAV|MP3|OGG|audio/i.test(problem)
        )
          relevant = true
      }
      if (relevant) attach(node.key, problem)
    }
    if (/All menus must be reachable/.test(problem))
      for (const menu of unreachableIvrMenus(definition))
        attach(ivrMenuKey(menu.id), problem)
    if (/Menu cycle without input/.test(problem)) {
      // Find menus participating in an automatic cycle, excluding safe predecessors.
      const menus = new Map(definition.menus.map((m) => [m.id, m]))
      for (const menu of definition.menus) {
        const visited = new Set<string>()
        const reaches = (id: string): boolean => {
          if (id === menu.id) return true
          if (visited.has(id)) return false
          visited.add(id)
          const next = menus.get(id)
          return (
            !!next &&
            [next.noInputAction, next.failureAction].some(
              (a) => a.kind === "submenu" && reaches(a.menuId)
            )
          )
        }
        if (
          [menu.noInputAction, menu.failureAction].some(
            (a) => a.kind === "submenu" && reaches(a.menuId)
          )
        )
          attach(ivrMenuKey(menu.id), problem)
      }
    }
  }
  return result
}

/** Strip API error envelopes and replace internal identifiers in visible copy. */
export function ivrProblemLabel(
  definition: IvrDefinition,
  problem: string
): string {
  let label = problem
  try {
    const parsed: unknown = JSON.parse(problem)
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof parsed.message === "string"
    )
      label = parsed.message
  } catch {
    /* Plain validation messages already are readable. */
  }
  if (label.startsWith("Dangling menu:"))
    return "Choose an existing menu destination."
  label = label.replace(
    /menus\.(\d+)/g,
    (_match, index) => definition.menus[Number(index)]?.name ?? "Menu"
  )
  for (const menu of definition.menus) {
    const escaped = menu.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    label = label.replace(
      new RegExp(`(?<![a-zA-Z0-9._:-])${escaped}(?![a-zA-Z0-9._:-])`, "g"),
      menu.name
    )
  }
  return label
}
