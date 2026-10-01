import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
const result = spawnSync(
  "uv",
  [
    "run",
    "--frozen",
    "--directory",
    "services/voice-agent",
    "python",
    "live_smoke.py",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      UV_CACHE_DIR: resolve("test-results/uv-cache"),
      UV_PYTHON_INSTALL_DIR: resolve("test-results/uv-python"),
    },
  }
)
process.exit(result.status ?? 1)
