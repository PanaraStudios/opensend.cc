import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { isBuiltin } from "node:module"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../../", import.meta.url))
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"))

function runtimeImports(source, filename) {
  const imports = []
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      if (
        clause?.isTypeOnly ||
        (bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly) &&
          !clause.name)
      )
        return
      imports.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((element) => element.isTypeOnly))
      )
        return
      imports.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      assert.ok(
        ts.isStringLiteralLike(node.arguments[0]),
        `Cannot audit a nonliteral import in ${filename}`
      )
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return imports
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    // Convex skips filenames with multiple dots, including tests and fixtures.
    // Configs are bundled separately and must also be audited.
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) &&
      (entry.name.split(".").length === 2 ||
        ["convex.config.ts", "auth.config.ts"].includes(entry.name))
      ? [path]
      : []
  })
}

// Workspace packages the backend imports by name, mapped to their source.
const WORKSPACE = {
  "@opensend/core/": "packages/core/src/",
  "@opensendcc/sdk/src/": "packages/sdk/src/",
  "@opensendcc/call-gateway/src/": "services/call-gateway/src/",
}
const OWNERS = [
  "packages/backend",
  "packages/core",
  "packages/sdk",
  "services/call-gateway",
]

function owner(filename) {
  const path = filename.slice(root.length)
  const found = OWNERS.find((dir) => path.startsWith(dir + "/"))
  assert.ok(found, `${path} is outside the backend's workspace packages`)
  return found
}

function localModule(filename, specifier) {
  const prefix = Object.keys(WORKSPACE).find((p) => specifier.startsWith(p))
  const path = prefix
    ? join(root, WORKSPACE[prefix], specifier.slice(prefix.length))
    : resolve(dirname(filename), specifier)
  const stem = path.replace(/\.[cm]?js$/, "")
  const candidates = [
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => stem + extension),
    path,
    ...[".js", ".mjs", ".cjs", ".json"].map((extension) => path + extension),
    ...["index.ts", "index.tsx", "index.js"].map((index) => join(path, index)),
  ]
  const found = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  )
  assert.ok(found, `Cannot resolve ${specifier} imported by ${filename}`)
  return found
}

const packageName = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")

test("each package the Convex bundle reaches declares what it imports", () => {
  // The migrate image deploys @opensend/backend with `pnpm deploy --prod`, so
  // every npm package a function reaches must be a dependency of the package
  // whose file imports it, at the version the web app uses.
  // zod is a pinned peer: without it the image resolves the zod peer of
  // convex-helpers and better-auth differently from the root install.
  const required = Object.fromEntries(OWNERS.map((dir) => [dir, new Set()]))
  required["packages/backend"].add("convex").add("zod")
  const pending = sourceFiles(join(root, "packages/backend/convex"))
  const visited = new Set()
  while (pending.length) {
    const filename = pending.pop()
    if (visited.has(filename) || filename.endsWith(".json")) continue
    visited.add(filename)
    const from = owner(filename)
    for (const specifier of runtimeImports(
      readFileSync(filename, "utf8"),
      filename
    )) {
      if (isBuiltin(specifier)) continue
      assert.ok(
        !specifier.startsWith("@/"),
        `${filename} imports the web app (${specifier})`
      )
      const workspace = Object.keys(WORKSPACE).find((p) =>
        specifier.startsWith(p)
      )
      if (workspace) required[from].add(packageName(specifier))
      if (specifier.startsWith(".") || workspace)
        pending.push(localModule(filename, specifier))
      else required[from].add(packageName(specifier))
    }
  }
  const backendConfig = "packages/backend/convex.json"
  const external = readJson(backendConfig).node?.externalPackages ?? []
  assert.ok(
    !external.includes("*"),
    "List external Node packages explicitly so they can be audited"
  )
  for (const name of external) required["packages/backend"].add(name)
  assert.deepEqual(
    readJson(backendConfig).node,
    readJson("convex.json").node,
    "Both convex.json files must give Convex the same Node settings"
  )

  const rootDependencies = readJson("package.json").dependencies
  for (const dir of OWNERS) {
    const declared = readJson(join(dir, "package.json")).dependencies ?? {}
    const needed = [...required[dir]].sort()
    if (dir === "packages/backend")
      assert.deepEqual(Object.keys(declared).sort(), needed)
    else
      for (const name of needed)
        assert.ok(name in declared, `${dir} must declare ${name}`)
    for (const name of needed)
      if (!declared[name].startsWith("workspace:"))
        assert.equal(
          declared[name],
          rootDependencies[name],
          `${dir}: ${name} must match the root version`
        )
  }
})

test("the workspace override pins convex-helpers to the root version", () => {
  const overrides = readFileSync(
    join(root, "pnpm-workspace.yaml"),
    "utf8"
  ).split(/^overrides:$/m)[1]
  assert.equal(
    overrides?.match(/^\s+convex-helpers: (\S+)$/m)?.[1],
    readJson("package.json").dependencies["convex-helpers"]
  )
})
