"use client"

import {
  WorkflowIcon,
  UsersIcon,
  BotIcon,
  VoicemailIcon,
  Volume2Icon,
  WebhookIcon,
  PhoneOffIcon,
  CornerDownRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FlowCatalog, FlowNodeProps } from "../flows/catalog"
import type { IvrAction, IvrDefinition, IvrMenu } from "@/lib/ivr"
import { MenuFields, ActionField, VoiceChoiceField } from "./ivr-fields"
import {
  ivrActionKey,
  ivrBranchAction,
  ivrBranchLabel,
  ivrMenuKey,
  setIvrBranch,
  type IvrFlowNode,
  type IvrBranchAddress,
} from "./ivr-graph"

export type IvrFlowContext = {
  definition: IvrDefinition
  bots: { id: string; name: string }[]
  updateMenu: (menu: IvrMenu) => void
  select: (key: string) => void
  removeMenu: (menu: IvrMenu) => void
  createMenu: (address: IvrBranchAddress) => void
}
type Kind = IvrFlowNode["kind"]
type Entry = FlowCatalog<IvrFlowNode, IvrFlowContext, Kind>["entries"][Kind]
export const IVR_ACTION_KINDS = [
  "menu",
  "submenu",
  "agents",
  "bot",
  "voicemail",
  "playAndHangup",
  "webhook",
  "hangup",
] as const

export function newIvrAction(
  kind: Exclude<Kind, "menu">,
  definition: IvrDefinition
): IvrAction {
  switch (kind) {
    case "submenu":
      return { kind, menuId: definition.entryMenuId }
    case "bot":
      return { kind, botId: "" }
    case "webhook":
      return { kind, url: "" }
    case "playAndHangup":
      return { kind, prompt: { kind: "tts", text: "" } }
    default:
      return { kind }
  }
}
function BranchEditor({
  address,
  context,
}: {
  address: IvrBranchAddress
  context: IvrFlowContext
}) {
  const menu = context.definition.menus.find((m) => m.id === address.menuId)
  if (!menu) return null
  const action = ivrBranchAction(menu, address.branch)
  const digit = !["noInputAction", "failureAction"].includes(address.branch)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {menu.name} · {ivrBranchLabel(address.branch)}
      </p>
      {digit ? (
        <VoiceChoiceField
          label="Digit"
          value={address.branch}
          items={"1234567890*#"
            .split("")
            .filter((d) => d === address.branch || !menu.options[d])
            .map((d) => ({ value: d, label: `Press ${d}` }))}
          onChange={(branch) => {
            const options = { ...menu.options }
            delete options[address.branch]
            options[branch] = action
            context.updateMenu({ ...menu, options })
            context.select(ivrActionKey({ menuId: menu.id, branch }))
          }}
        />
      ) : null}
      <ActionField
        label="Destination action"
        menus={context.definition.menus}
        value={action}
        onChange={(action) =>
          context.updateMenu(setIvrBranch(menu, address.branch, action))
        }
      />
      <Button
        variant="outline"
        disabled={context.definition.menus.length >= 50}
        onClick={() => context.createMenu(address)}
      >
        Create submenu here
      </Button>
      {digit ? (
        <Button
          variant="ghost"
          onClick={() => {
            const options = { ...menu.options }
            delete options[address.branch]
            context.updateMenu({ ...menu, options })
            context.select(ivrMenuKey(menu.id))
          }}
        >
          Remove option
        </Button>
      ) : null}
    </div>
  )
}
function MenuEditor({
  node,
  context,
}: FlowNodeProps<IvrFlowNode, IvrFlowContext>) {
  return (
    <>
      <h2 className="text-base font-medium">{node.menu.name}</h2>
      <MenuFields
        menu={node.menu}
        menus={context.definition.menus}
        onChange={context.updateMenu}
        showBranches={false}
      />
      <Button
        variant="ghost"
        disabled={context.definition.menus.length === 1}
        onClick={() => context.removeMenu(node.menu)}
      >
        Remove menu
      </Button>
    </>
  )
}
function ActionEditor({
  node,
  context,
}: FlowNodeProps<IvrFlowNode, IvrFlowContext>) {
  return node.address ? (
    <BranchEditor address={node.address} context={context} />
  ) : null
}
function actionEntry(icon: Entry["icon"], label: string): Entry {
  return {
    icon,
    label,
    summary: (node, context) => {
      const action = node.action
      if (action?.kind === "bot")
        return (
          context.bots.find((bot) => bot.id === action.botId)?.name ??
          "Choose a voice bot"
        )
      if (action?.kind === "webhook") return action.url || "Set webhook URL"
      if (action?.kind === "playAndHangup")
        return action.prompt.kind === "tts"
          ? action.prompt.text || "Add a message"
          : "Audio message"
      return null
    },
    branches: () => [],
    addAfter: () => [],
    Editor: ActionEditor,
  }
}
export const ivrCatalog: FlowCatalog<IvrFlowNode, IvrFlowContext, Kind> = {
  kind: (node) => node.kind,
  entries: {
    menu: {
      icon: WorkflowIcon,
      label: "New menu",
      title: (node) => node.menu.name,
      summary: (node) =>
        node.menu.prompt.kind === "tts"
          ? `“${node.menu.prompt.text}”`
          : "Audio prompt",
      branches: (node) => node.branches,
      addAfter: () => IVR_ACTION_KINDS,
      Editor: MenuEditor,
    },
    submenu: {
      ...actionEntry(CornerDownRightIcon, "Go to menu"),
      title: (node, context) => {
        const action = node.action
        return `Go to ${action?.kind === "submenu" ? (context.definition.menus.find((menu) => menu.id === action.menuId)?.name ?? "missing menu") : "menu"}`
      },
      selectKey: (node, context) => {
        const action = node.action
        return action?.kind === "submenu" &&
          context.definition.menus.some((menu) => menu.id === action.menuId)
          ? ivrMenuKey(action.menuId)
          : node.key
      },
    },
    agents: actionEntry(UsersIcon, "Transfer to agents"),
    bot: actionEntry(BotIcon, "Voice bot"),
    voicemail: actionEntry(VoicemailIcon, "Voicemail"),
    playAndHangup: actionEntry(Volume2Icon, "Play message and hang up"),
    webhook: actionEntry(WebhookIcon, "Webhook"),
    hangup: actionEntry(PhoneOffIcon, "Hang up"),
  },
}
