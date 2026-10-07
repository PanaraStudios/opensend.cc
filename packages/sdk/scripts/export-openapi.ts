import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseDocument, visit } from "yaml"

// Emit plain YAML: expand aliases before removing anchors, including reused
// anchor names from concatenated exports. Preserve comments and scalar styles.
// Run: pnpm --filter @opensendcc/sdk exec tsx scripts/export-openapi.ts
const path = fileURLToPath(
  new URL("../../../openapi/opensend.yaml", import.meta.url)
)
const document = parseDocument(readFileSync(path, "utf8"))
if (document.errors.length) throw document.errors[0]
visit(document, {
  Alias: (_key, node) => {
    const target = node.resolve(document)
    if (!target) throw new Error(`Unresolved YAML alias: ${node.source}`)
    return target.clone()
  },
})
visit(document, (_key, node) => {
  if (node && typeof node === "object" && "anchor" in node)
    node.anchor = undefined
})
writeFileSync(path, document.toString({ singleQuote: true, lineWidth: 100 }))
