/** Convex replays only --history N entries on its first poll. Wait until
 * that poll has advanced its cursor before creating the bootstrap account,
 * so its verification link cannot fall outside that initial history window. */
export function waitForLogStream(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let pending = ""
    const finish = (error) => {
      clearTimeout(timer)
      child.stdout.off("data", onData)
      child.off("error", onError)
      child.off("exit", onExit)
      if (error) reject(error)
      else resolve()
    }
    const onData = (chunk) => {
      pending += chunk
      const lines = pending.split("\n")
      pending = lines.pop()
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry && typeof entry === "object") {
            finish()
            return
          }
        } catch {
          // Ignore banners; partial JSON stays in pending until the next chunk.
        }
      }
    }
    const onError = (error) => finish(error)
    const onExit = (code, signal) =>
      finish(
        new Error(
          `Installer log watcher exited before its first JSONL entry (${signal || code})`
        )
      )
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Installer log watcher did not receive its first JSONL entry"
          )
        ),
      timeoutMs
    )
    child.stdout.on("data", onData)
    child.once("error", onError)
    child.once("exit", onExit)
  })
}
