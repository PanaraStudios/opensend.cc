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

function localModule(filename, specifier) {
  const path = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
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

test("migrate dependencies cover the Convex runtime graph and match root versions", () => {
  // zod is a pinned peer: without it the image resolves the zod peer of
  // convex-helpers and better-auth differently from the root install.
  const required = new Set(["convex", "zod"])
  const pending = sourceFiles(join(root, "convex"))
  const visited = new Set()
  while (pending.length) {
    const filename = pending.pop()
    if (visited.has(filename) || filename.endsWith(".json")) continue
    visited.add(filename)
    for (const specifier of runtimeImports(
      readFileSync(filename, "utf8"),
      filename
    )) {
      if (isBuiltin(specifier)) continue
      if (specifier.startsWith(".") || specifier.startsWith("@/"))
        pending.push(localModule(filename, specifier))
      else
        required.add(
          specifier
            .split("/")
            .slice(0, specifier.startsWith("@") ? 2 : 1)
            .join("/")
        )
    }
  }
  if (existsSync(join(root, "convex.json"))) {
    const external = readJson("convex.json").node?.externalPackages ?? []
    assert.ok(
      !external.includes("*"),
      "List external Node packages explicitly so they can be audited"
    )
    for (const name of external) required.add(name)
  }
  const dependencies = readJson("docker/migrate/package.json").dependencies
  assert.deepEqual(Object.keys(dependencies).sort(), [...required].sort())
  const rootDependencies = readJson("package.json").dependencies
  for (const [name, version] of Object.entries(dependencies))
    assert.equal(
      version,
      rootDependencies[name],
      `${name} must match the root version`
    )
})
