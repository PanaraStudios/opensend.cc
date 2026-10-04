import { strict as assert } from "node:assert"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { newIvr, newIvrMenu } from "./voice-playground"
import type { IvrDefinition } from "../ivr"
import {
  ivrGraph,
  ivrEditableNodes,
  ivrMenuKey,
  ivrMenuReferences,
  removeIvrMenu,
  nextIvrDigit,
  ivrProblemNodes,
  ivrProblemLabel,
  type IvrFlowNode,
} from "../../components/dashboard/playground/ivr-graph"
import {
  ivrCatalog,
  newIvrAction,
  IVR_ACTION_KINDS,
  type IvrFlowContext,
} from "../../components/dashboard/playground/ivr-catalog"
import { automationCatalog } from "../../components/dashboard/automations/catalog"
import { STEP_GROUPS, STEP_LABELS, newStep, stepBranches } from "./automation"
import { FlowEditor } from "../../components/dashboard/flows/editor"

function fixture(): IvrDefinition {
  const main = {
    ...newIvrMenu(),
    name: "Reception",
    prompt: { kind: "tts" as const, text: "Welcome" },
  }
  const support = {
    ...newIvrMenu("support"),
    name: "Support",
    prompt: { kind: "tts" as const, text: "How can we help?" },
  }
  main.options = {
    "1": { kind: "submenu", menuId: "support" },
    "2": { kind: "submenu", menuId: "support" },
    "*": { kind: "hangup" },
  }
  support.options = {
    "0": { kind: "submenu", menuId: "main" },
    "1": { kind: "bot", botId: "bot-secret-id" },
  }
  return { ...newIvr(), name: "Reception", menus: [main, support] }
}
function context(definition: IvrDefinition): IvrFlowContext {
  return {
    definition,
    bots: [{ id: "bot-secret-id", name: "Support assistant" }],
    updateMenu() {},
    select() {},
    removeMenu() {},
    createMenu() {},
  }
}
test("IVR draws a shared submenu once; repeated references and loops become links", () => {
  const graph = ivrGraph(fixture())
  assert.equal(graph.root?.kind, "menu")
  assert.equal(graph.root?.menu.id, "main")
  assert.equal(
    graph.nodes.filter(
      (node) => node.kind === "menu" && node.menu.id === "support"
    ).length,
    1
  )
  const branches = graph.root!.branches
  assert.deepEqual(
    branches.map((branch) => branch.label),
    ["Press 1", "Press 2", "Press *", "No input", "Invalid input"]
  )
  assert.equal(branches[0].steps[0].kind, "menu")
  assert.equal(branches[1].steps[0].kind, "submenu")
  const back = branches[0].steps[0].branches[0].steps[0]
  assert.deepEqual(back.action, { kind: "submenu", menuId: "main" })
  assert.equal(back.branches.length, 0)
  assert.equal(
    new Set(graph.nodes.map((node) => node.key)).size,
    graph.nodes.length
  )
  assert.deepEqual(graph.unreachable, [])
})
test("IVR lists disconnected cycles and menus reachable only during closed hours", () => {
  const definition = fixture()
  const one = newIvrMenu("one"),
    two = newIvrMenu("two")
  one.options["1"] = { kind: "submenu", menuId: "two" }
  two.options["1"] = { kind: "submenu", menuId: "one" }
  definition.menus.push(one, two)
  definition.businessHours = {
    status: "DISABLED",
    closedAction: { kind: "submenu", menuId: "one" },
  }
  const graph = ivrGraph(definition)
  assert.deepEqual(
    graph.otherMenus.map((menu) => menu.id),
    ["one", "two"]
  )
  assert.deepEqual(graph.unreachable, [])
  assert.equal(graph.nodes.filter((node) => node.kind === "menu").length, 4)
})
test("IVR self-loops and missing targets terminate as selectable links", () => {
  const definition = fixture()
  definition.menus[0].options = {
    "1": { kind: "submenu", menuId: "main" },
    "2": { kind: "submenu", menuId: "missing" },
  }
  const graph = ivrGraph(definition)
  const self = graph.root!.branches[0].steps[0],
    missing = graph.root!.branches[1].steps[0]
  assert.equal(
    ivrCatalog.entries.submenu.selectKey!(self, context(definition)),
    ivrMenuKey("main")
  )
  assert.equal(
    ivrCatalog.entries.submenu.selectKey!(missing, context(definition)),
    missing.key
  )
  assert.equal(graph.nodes.length, 5)
})
test("removing a referenced entry menu repairs digits, fallbacks, business hours and entry", () => {
  const definition = fixture()
  definition.menus[1].noInputAction = { kind: "submenu", menuId: "main" }
  definition.menus[1].failureAction = { kind: "submenu", menuId: "main" }
  definition.businessHours = {
    status: "DISABLED",
    closedAction: { kind: "submenu", menuId: "main" },
  }
  assert.deepEqual(ivrMenuReferences(definition, "main"), [
    "Entry menu",
    "Support · Press 0",
    "Support · No input",
    "Support · Invalid input",
    "Business hours · When closed",
  ])
  const next = removeIvrMenu(definition, "main")
  assert.equal(next.entryMenuId, "support")
  assert.equal(next.menus.length, 1)
  assert.deepEqual(next.menus[0].options["0"], { kind: "hangup" })
  assert.deepEqual(next.menus[0].noInputAction, { kind: "hangup" })
  assert.deepEqual(next.menus[0].failureAction, { kind: "hangup" })
  assert.deepEqual(next.businessHours!.closedAction, { kind: "hangup" })
  assert.equal(ivrMenuReferences(next, "main").length, 0)
})
test("IVR offers the next free digit and stops at all twelve keypad keys", () => {
  const menu = newIvrMenu()
  for (const digit of "1234567890*#") {
    assert.equal(nextIvrDigit(menu), digit)
    menu.options[digit] = { kind: "hangup" }
  }
  assert.equal(nextIvrDigit(menu), undefined)
  delete menu.options["4"]
  assert.equal(nextIvrDigit(menu), "4")
})
test("IVR catalog wires every action, readable summaries, menu branches and editors", () => {
  const definition = fixture(),
    graph = ivrGraph(definition),
    ctx = context(definition)
  assert.deepEqual(Object.keys(ivrCatalog.entries), [...IVR_ACTION_KINDS])
  assert.deepEqual(
    ivrCatalog.entries.menu.branches(graph.root!),
    graph.root!.branches
  )
  assert.deepEqual(ivrCatalog.entries.menu.addAfter(graph.root!), [
    ...IVR_ACTION_KINDS,
  ])
  for (const kind of IVR_ACTION_KINDS) {
    const entry = ivrCatalog.entries[kind]
    assert.ok(entry.icon)
    assert.ok(entry.label)
    assert.equal(typeof entry.Editor, "function")
    if (kind === "menu") continue
    const action = newIvrAction(kind, definition)
    const node = {
      key: kind,
      kind,
      action,
      menu: definition.menus[0],
      branches: [],
    }
    assert.equal(ivrCatalog.kind(node), kind)
    assert.deepEqual(entry.addAfter(node), [])
    assert.deepEqual(entry.branches(node), [])
    assert.doesNotThrow(() => entry.summary(node, ctx))
  }
  const bot = graph.nodes.find((node) => node.kind === "bot")!
  assert.equal(ivrCatalog.entries.bot.summary(bot, ctx), "Support assistant")
  const link = graph.root!.branches[1].steps[0]
  assert.equal(ivrCatalog.entries.submenu.title!(link, ctx), "Go to Support")
  assert.equal(
    ivrCatalog.entries.submenu.selectKey!(link, ctx),
    ivrMenuKey("support")
  )
})
test("automation catalog covers unchanged kinds, labels, branch order and inline editors", () => {
  const types = STEP_GROUPS.flatMap((group) => group.types)
  assert.deepEqual(
    Object.keys(automationCatalog.entries).sort(),
    [...types].sort()
  )
  for (const type of types) {
    const entry = automationCatalog.entries[type],
      node = newStep(type, [])
    assert.equal(automationCatalog.kind(node), type)
    assert.equal(entry.label, STEP_LABELS[type])
    assert.deepEqual(entry.branches(node), stepBranches(node))
    assert.deepEqual(entry.addAfter(node), types)
    assert.equal(typeof entry.Editor, "function")
    assert.equal(typeof entry.Card, "function")
  }
})
test("both shared canvas layouts render IVR catalog labels and keyboard buttons", () => {
  const definition = fixture(),
    graph = ivrGraph(definition)
  for (const stacked of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(
        FlowEditor<IvrFlowNode, IvrFlowContext, IvrFlowNode["kind"]>,
        {
          catalog: ivrCatalog,
          context: context(definition),
          steps: [graph.root!],
          selected: null,
          onSelect() {},
          stacked,
        }
      )
    )
    assert.match(html, /data-testid="workflow-node-menu:main"/)
    assert.match(html, /aria-label="Go to Support"/)
    assert.match(html, /Press \*/)
    assert.match(html, /Support assistant/)
    assert.doesNotMatch(html, /bot-secret-id/)
    assert.match(html, /aria-label="Zoom in"/)
  }
})
test("validation maps prompts, destinations, disconnected menus and automatic cycles", () => {
  const definition = fixture()
  definition.menus[0].prompt = { kind: "tts", text: "" }
  definition.menus[0].options["3"] = { kind: "webhook", url: "" }
  definition.menus.push(newIvrMenu("unused"))
  const errors = ivrProblemNodes(definition, [
    "Invalid TTS text",
    "Invalid IVR string",
    "All menus must be reachable",
    "Choose a team key for the prompt provider",
  ])
  assert.ok(errors.get(ivrMenuKey("main"))?.includes("Invalid TTS text"))
  assert.ok(errors.get("action:main:3")?.includes("Invalid IVR string"))
  assert.ok(
    errors.get(ivrMenuKey("unused"))?.includes("All menus must be reachable")
  )
  assert.ok(
    [...errors.values()].every(
      (values) => !values.includes("Choose a team key for the prompt provider")
    )
  )
  definition.menus[0].noInputAction = { kind: "submenu", menuId: "support" }
  definition.menus[1].failureAction = { kind: "submenu", menuId: "main" }
  const cycles = ivrProblemNodes(definition, ["Menu cycle without input"])
  assert.ok(cycles.has(ivrMenuKey("main")))
  assert.ok(cycles.has(ivrMenuKey("support")))
  assert.ok(!cycles.has(ivrMenuKey("unused")))
})

test("validation labels use menu names and strip API envelopes", () => {
  const definition = fixture()
  assert.equal(
    ivrProblemLabel(
      definition,
      JSON.stringify({ code: "invalid", message: "menus.1 prompt is invalid" })
    ),
    "Support prompt is invalid"
  )
  assert.equal(
    ivrProblemLabel(definition, "Check support · no input"),
    "Check Support · no input"
  )
  assert.equal(
    ivrProblemLabel(definition, "Dangling menu: internal-id"),
    "Choose an existing menu destination."
  )
})

test("full submenu incoming paths remain editable and unnamed catalog paths render without badges", () => {
  const definition = fixture()
  const graph = ivrGraph(definition)
  const incoming = ivrEditableNodes(definition).find(
    (node) => node.key === "action:main:1"
  )!
  assert.deepEqual(incoming.action, { kind: "submenu", menuId: "support" })
  assert.deepEqual(incoming.address, { menuId: "main", branch: "1" })
  graph.root!.branches = [
    { id: "next", steps: [graph.root!.branches[2].steps[0]] },
  ]
  const html = renderToStaticMarkup(
    createElement(
      FlowEditor<IvrFlowNode, IvrFlowContext, IvrFlowNode["kind"]>,
      {
        catalog: ivrCatalog,
        context: context(definition),
        steps: [graph.root!],
        selected: null,
        onSelect() {},
      }
    )
  )
  assert.match(html, /aria-label="Hang up"/)
  assert.doesNotMatch(html, /data-slot="badge"/)
})

test("validation respects closed-hours reachability and can select disconnected destinations", () => {
  const definition = fixture()
  const closed = newIvrMenu("closed"),
    disconnected = newIvrMenu("disconnected")
  closed.prompt = { kind: "tts", text: "We are closed" }
  disconnected.prompt = { kind: "tts", text: "Try again" }
  disconnected.options["1"] = { kind: "webhook", url: "" }
  definition.menus.push(closed, disconnected)
  definition.businessHours = {
    status: "DISABLED",
    closedAction: { kind: "submenu", menuId: closed.id },
  }
  const problems = ivrProblemNodes(definition, [
    "All menus must be reachable",
    "Invalid IVR string",
  ])
  assert.equal(problems.has(ivrMenuKey(closed.id)), false)
  assert.ok(problems.has(ivrMenuKey(disconnected.id)))
  assert.ok(
    problems.get("action:disconnected:1")?.includes("Invalid IVR string")
  )
})
