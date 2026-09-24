import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { freePort, parse, removeTestInstance, run } from "./lib.mjs"
const sourceFile = process.argv[2]
if (!sourceFile?.includes(".env.playwright-opensend-e2e-"))
  throw new Error("Supply an isolated test instance environment file")
const source = parse(readFileSync(sourceFile, "utf8"))
if (!source.INSTANCE_NAME?.startsWith("opensend-e2e-"))
  throw new Error("Refusing non-test export")
const name = `opensend-e2e-restore-${Date.now()}`
const directory = resolve("test-results", name)
mkdirSync(directory, { recursive: true })
const original = resolve(directory, "source.zip")
const restored = resolve(directory, "restored.zip")
const targetFile = resolve(`.env.playwright-${name}`)
const port = await freePort()
const sitePort = await freePort()
const target = {
  ...source,
  INSTANCE_NAME: name,
  INSTANCE_SECRET: randomBytes(32).toString("hex"),
  CONVEX_PORT: port,
  CONVEX_SITE_PORT: sitePort,
  CONVEX_PUBLIC_URL: `http://localhost:${port}`,
  CONVEX_PUBLIC_SITE_URL: `http://host.docker.internal:${sitePort}`,
  CONVEX_BACKEND_ORIGIN: `http://host.docker.internal:${port}`,
}
delete target.CONVEX_SELF_HOSTED_ADMIN_KEY
writeFileSync(
  targetFile,
  Object.entries(target)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600 }
)
const env = {
  ...process.env,
  OPENSEND_ENV_FILE: targetFile,
  COMPOSE_PROJECT_NAME: name,
  OPENSEND_BACKEND_ONLY: "1",
}
try {
  console.log(
    `Backup source: disposable test ${source.INSTANCE_NAME}; restore target: local ${name}`
  )
  run(
    "node",
    [
      "scripts/backend.mjs",
      "export",
      "--include-file-storage",
      "--path",
      original,
    ],
    { env: { ...process.env, OPENSEND_ENV_FILE: sourceFile } }
  )
  run("node", ["scripts/setup.mjs"], { env })
  run(
    "node",
    ["scripts/backend.mjs", "import", "--replace-all", "--yes", original],
    { env }
  )
  run(
    "node",
    [
      "scripts/backend.mjs",
      "export",
      "--include-file-storage",
      "--path",
      restored,
    ],
    { env }
  )
  // Compare stable application/auth rows, not queue heartbeat/checkpoint metadata.
  run("python3", [
    "-c",
    `import json,zipfile,sys
paths=['installation/documents.jsonl','domains/documents.jsonl','domainHistory/documents.jsonl','sesRegions/documents.jsonl','_components/betterAuth/bootstrap/documents.jsonl','_components/betterAuth/user/documents.jsonl','_components/betterAuth/member/documents.jsonl','_components/betterAuth/organization/documents.jsonl']
with zipfile.ZipFile(sys.argv[1]) as a, zipfile.ZipFile(sys.argv[2]) as b:
 for path in paths:
  normalize=lambda z: sorted((json.loads(line) for line in z.read(path).splitlines() if line),key=lambda r:r['_id'])
  before,after=normalize(a),normalize(b)
  assert before==after,path
  print(path+': '+str(len(after))+' rows restored exactly')
`,
    original,
    restored,
  ])
  writeFileSync(
    resolve(directory, "result.json"),
    JSON.stringify(
      {
        passed: true,
        source: source.INSTANCE_NAME,
        target: name,
        sourceSnapshot: original,
        restoredSnapshot: restored,
        verified:
          "installation, domains, history, regions, bootstrap, users, membership and teams",
      },
      null,
      2
    )
  )
} finally {
  removeTestInstance(targetFile, name, [
    "compose",
    "--env-file",
    targetFile,
    "-p",
    name,
  ])
}
