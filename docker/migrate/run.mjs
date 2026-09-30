import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { convexEnvEntries } from "../../scripts/convex-env.mjs"

const require = createRequire(import.meta.url)
const cli = resolve(
  dirname(require.resolve("convex/package.json")),
  "bin/main.js"
)

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit" })
    const forward = (signal) => child.kill(signal)
    const onTerm = () => forward("SIGTERM")
    const onInt = () => forward("SIGINT")
    process.on("SIGTERM", onTerm)
    process.on("SIGINT", onInt)
    const cleanup = () => {
      process.off("SIGTERM", onTerm)
      process.off("SIGINT", onInt)
    }
    child.once("error", (error) => {
      cleanup()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      cleanup()
      if (code === 0) resolve()
      else reject(new Error(`Convex ${args[0]} failed (${signal || code})`))
    })
  })
}

async function waitForBackend() {
  const url = `${process.env.CONVEX_SELF_HOSTED_URL.replace(/\/$/, "")}/version`
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(5000, deadline - Date.now())),
      })
      await response.body?.cancel()
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Convex did not become ready at ${url} within 120 seconds`)
}

try {
  const selfHosted = !!process.env.CONVEX_SELF_HOSTED_ADMIN_KEY
  const cloud = !!process.env.CONVEX_DEPLOY_KEY
  if (selfHosted && cloud)
    throw new Error(
      "Set only one of CONVEX_SELF_HOSTED_ADMIN_KEY or CONVEX_DEPLOY_KEY"
    )
  if (!selfHosted && !cloud)
    throw new Error(
      "CONVEX_SELF_HOSTED_ADMIN_KEY (self-hosted) or CONVEX_DEPLOY_KEY (cloud) is required"
    )
  delete process.env.CONVEX_DEPLOYMENT
  if (cloud) delete process.env.CONVEX_SELF_HOSTED_URL
  else {
    delete process.env.CONVEX_DEPLOY_KEY
    process.env.CONVEX_SELF_HOSTED_URL ||= "http://convex:3210"
  }
  const args = process.argv.slice(2)
  if (args.length) await runCli(args)
  else {
    if (selfHosted) await waitForBackend()
    for (const [key, value] of convexEnvEntries(process.env))
      await runCli(["env", "set", `${key}=${value}`])
    await runCli([
      "deploy",
      "--yes",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
    ])
  }
} catch (error) {
  console.error(`Opensend migrate: ${error.message}`)
  process.exitCode = 1
}
