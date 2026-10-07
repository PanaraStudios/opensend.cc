import ts from "typescript"
import { Opensend } from "../src/resend"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { load } from "js-yaml"

/**
 * Every request the SDK makes must be an operation in Opensend's OpenAPI
 * contract, and every operation in the contract must have an SDK method, so
 * drift on either side fails here. Requests are read from the source: each
 * `this.resend.<method>(…)` call with its path literal, or with the literal
 * assigned to the `url`/`path` variable it passes.
 */

/** Apply the anchor-uniqueness rule used by PyYAML and strict code generators. */
function loadStrictYaml(source: string) {
  const anchors = new Set<string>()
  return load(source, {
    onWarning: error => { throw error },
    listener: (event, state) => {
      if (event !== "close" || !("anchor" in state) || typeof state.anchor !== "string") return
      if (anchors.has(state.anchor)) throw new Error(`Duplicate YAML anchor: ${state.anchor}`)
      anchors.add(state.anchor)
    },
  })
}

const root = join(__dirname, "..")
const spec = parse(
  readFileSync(join(root, "../../openapi/opensend.yaml"), "utf8")
) as { paths: Record<string, Record<string, unknown>> }

const METHODS = ["get", "post", "put", "patch", "delete"]

/** Parameters become `{}`; the query string is dropped, including one
    appended through a placeholder (`/templates${query}`). */
const normalize = (path: string) =>
  path
    .replace(/\$\{[^}]*\}/g, "{}")
    .replace(/\{[^}]*\}/g, "{}")
    .split("?")[0]
    .replace(/([^/])\{\}$/, "$1")

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")
      ? [path]
      : []
  })

const firstLiteral = (text: string) =>
  text.match(/(['"`])(\/[^'"`]*)\1/)?.[2] ?? null

function sdkRequests() {
  const found = new Set<string>()
  for (const file of sources(join(root, "src"))) {
    const text = readFileSync(file, "utf8")
    // Shared channel adapters resolve their route from the subclass constructor.
    const channel = text.match(
      /super\(client, [\'"](whatsapp|messenger|instagram)[\'"]\)/
    )?.[1]
    if (channel && text.includes("extends ChannelConversations")) {
      found.add(`POST /${channel}/conversations/{}/typing`)
      found.add(`GET /${channel}/conversations`)
      found.add(`GET /${channel}/conversations/{}/messages`)
    }
    if (channel && text.includes("extends ChannelMessages")) {
      found.add(`POST /${channel}/messages/{}/read`)
      found.add(`POST /${channel}/messages`)
      found.add(`GET /${channel}/messages`)
      found.add(`GET /${channel}/messages/{}`)
    }
    const accountPath = text.match(
      /super\(client, [\'"](\/(?:whatsapp|messenger|instagram)\/(?:phone-numbers|pages|accounts))[\'"]\)/
    )?.[1]
    if (accountPath && text.includes("extends ChannelAccounts")) {
      found.add(`GET ${accountPath}`)
      found.add(`GET ${accountPath}/{}`)
    }
    const assignments: { at: number; name: string; literal: string }[] = []
    for (const match of text.matchAll(
      /const (url|path) =([\s\S]*?)(?:;|\n\s*(?:return|const)\s)/g
    )) {
      const literal = firstLiteral(match[2])
      if (literal)
        assignments.push({ at: match.index, name: match[1], literal })
    }
    const calls = text.matchAll(
      /this\.resend\.(get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*((['"`])[\s\S]*?\3|\w+)/g
    )
    for (const call of calls) {
      const [, method, argument] = call
      const literal =
        firstLiteral(argument) ??
        assignments
          .filter((a) => a.name === argument && a.at < call.index)
          .at(-1)?.literal
      if (!literal) throw new Error(`Unresolved request path in ${file}`)
      found.add(`${method.toUpperCase()} ${normalize(literal)}`)
    }
  }
  return found
}

function contractOperations() {
  const found = new Set<string>()
  for (const [path, item] of Object.entries(spec.paths))
    for (const method of METHODS)
      if (item[method]) found.add(`${method.toUpperCase()} ${normalize(path)}`)
  return found
}

/** Resend's older `contacts.*` forms that take `audienceId`. Opensend does
    not serve these routes, so the server answers 404. */
const LEGACY = new Set<string>([
  "POST /audiences/{}/contacts",
  "GET /audiences/{}/contacts/{}",
  "PATCH /audiences/{}/contacts/{}",
  "DELETE /audiences/{}/contacts/{}",
])

/** Served operations with no SDK method of their own: the SMTP gateway's
    bridge, and the deprecated `/audiences` aliases (the SDK's `audiences`
    is the segments client, which calls `/segments`). */
const exceptions = JSON.parse(
  readFileSync(join(root, "test/rest-parity-exceptions.json"), "utf8")
) as Record<string, string>
const NOT_EXPOSED = new Set(Object.keys(exceptions).map((op) => normalize(op)))

describe("REST and OpenAPI binding contract", () => {
  const sdk = sdkRequests()
  const contract = contractOperations()

  it("loads the checked-in YAML with a strict parser and contains no anchors or aliases", async () => {
    const source = readFileSync(join(root, "../../openapi/opensend.yaml"), "utf8")
    expect(source).not.toMatch(/(?:^|\s)[&*][a-zA-Z0-9_-]+(?:\s|$)/m)
    expect(() => loadStrictYaml("first: &a1 {}\nsecond: &a1 {}\n")).toThrow(/duplicat/i)
    expect(loadStrictYaml(source)).toHaveProperty("openapi", "3.1.0")
  })

  it("finds the SDK requests", () => {
    expect(sdk.size).toBeGreaterThan(80)
  })

  it("every SDK request matches OpenAPI", () => {
    const missing = [...sdk].filter(
      (op) => !contract.has(op) && !LEGACY.has(op)
    )
    expect(missing.sort()).toEqual([])
  })

  it("every contract operation has an SDK method", () => {
    const uncovered = [...contract].filter(
      (op) => !sdk.has(op) && !NOT_EXPOSED.has(op)
    )
    expect(uncovered.sort()).toEqual([])
  })

  it("every POST wrapper forwards optional request options", () => {
    const missing: string[] = []
    for (const file of sources(join(root, "src"))) {
      const code = readFileSync(file, "utf8")
      const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          /^this\.(resend|client)\.post$/.test(node.expression.getText(tree)) &&
          node.arguments.length !== 3
        )
          missing.push(
            file.replace(root + "/", "") +
              ":" +
              tree.getLineAndCharacterOfPosition(node.getStart(tree)).line
          )
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
    expect(missing).toEqual([])
  })

  it("every inventory SDK binding is a public callable method", () => {
    const client = new Opensend("fixture-credential", {
      baseUrl: "https://api.test",
    })
    const rows = readFileSync(join(root, "../../docs/qa/dx-parity.md"), "utf8")
      .split("\n")
      .filter((line) => /^\| (GET|POST|PATCH|DELETE) \|/.test(line))
    for (const row of rows) {
      const columns = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      for (const match of columns[3].matchAll(/`([^`]+)`/g)) {
        let method: unknown = client
        for (const key of match[1].split("."))
          method = (method as Record<string, unknown>)[key]
        expect(
          typeof method,
          columns[0] + " " + columns[1] + " " + match[1]
        ).toBe("function")
        expect(match[1]).not.toMatch(
          /\.perform|\.forwardPassthrough|\.forwardWrapped/
        )
      }
    }
  })

  it("keeps the exception lists current", () => {
    expect([...LEGACY].filter((op) => !sdk.has(op))).toEqual([])
    expect([...NOT_EXPOSED].filter((op) => !contract.has(op))).toEqual([])
  })
})

test("OpenAPI declares and groups every channel tag without changing operations", () => {
  const contract = parse(
    readFileSync(join(root, "../../openapi/opensend.yaml"), "utf8")
  ) as {
    tags: { name: string }[]
    "x-tagGroups": { name: string; tags: string[] }[]
    paths: Record<string, Record<string, { tags?: string[] }>>
  }
  const tags = new Set(contract.tags.map((tag) => tag.name))
  for (const channel of ["WhatsApp", "Messenger", "Instagram"])
    expect(
      contract["x-tagGroups"].find((group) => group.name === channel)?.tags
    ).toContain(channel)
  expect(
    contract["x-tagGroups"].find((group) => group.name === "Email")?.tags
  ).toContain("Emails")
  for (const path of Object.values(contract.paths))
    for (const operation of Object.values(path))
      for (const tag of operation.tags ?? [])
        expect(tags.has(tag), tag).toBe(true)
  for (const group of contract["x-tagGroups"])
    for (const tag of group.tags) expect(tags.has(tag), tag).toBe(true)
})

test("broadcast request and response schemas accept all four additive channels", () => {
  const contract = parse(
    readFileSync(join(root, "../../openapi/opensend.yaml"), "utf8")
  ) as {
    components: {
      schemas: Record<
        string,
        { properties: Record<string, { enum?: string[] }> }
      >
    }
  }
  for (const name of [
    "CreateBroadcastOptions",
    "UpdateBroadcastOptions",
    "BroadcastListItem",
    "GetBroadcastResponseSuccess",
  ])
    expect(contract.components.schemas[name].properties.channel.enum).toEqual([
      "email",
      "whatsapp",
      "messenger",
      "instagram",
    ])
  expect(
    contract.components.schemas.CreateBroadcastOptions.properties.messaging
  ).toBeDefined()
})
