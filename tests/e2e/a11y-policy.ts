// Only evidenced third-party or deliberate exceptions belong here, with a reason
// beside each rule id. Empty until the Linux tour establishes a justified case.
// Allowlisted rules are still scanned and recorded; only failure gating changes.
export const A11Y_RULE_ALLOWLIST: ReadonlySet<string> = new Set([])

// Only sandboxed customer HTML, shared by email/template previews and raw HTML
// editor blocks. Excluding the frame removes it from AxeBuilder's frame traversal;
// other frames remain eligible. Do not broaden this to every iframe or sandbox.
export const A11Y_PREVIEW_FRAME_SELECTOR =
  'iframe[data-slot="email-preview-frame"]'
export const A11Y_SCAN_MAX_MS = 20_000

export class A11yScanTimeoutError extends Error {
  constructor(maxMs: number) {
    super(`axe scan exceeded its ${maxMs / 1000}s budget`)
    this.name = "A11yScanTimeoutError"
  }
}

export async function withinA11yScanBudget<Result>(
  scan: () => Promise<Result>,
  maxMs = A11Y_SCAN_MAX_MS
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const started = performance.now()
  try {
    const result = await Promise.race([
      scan(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new A11yScanTimeoutError(maxMs)), maxMs)
      }),
    ])
    // Also enforce the deadline if the event loop delays delivery of the timer.
    if (performance.now() - started > maxMs)
      throw new A11yScanTimeoutError(maxMs)
    return result
  } finally {
    clearTimeout(timer)
  }
}

export const A11Y_FULL_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "best-practice",
]

// Both rules in the full tags depend on theme colours. Inline links must also
// be distinguishable from surrounding text (WCAG 1.4.1), not just the background.
export const A11Y_THEME_RULES = ["color-contrast", "link-in-text-block"]

// Full mobile scans only for visited states with different rendered structure.
// Profile covers the shared mobile shell once, including its sidebar trigger.
// Closed menus/sheets remain unvisited, as in the existing visual tour.
export const A11Y_MOBILE_STATES: ReadonlyMap<string, string> = new Map([
  [
    "profile",
    "Shared shell replaces desktop navigation with a mobile sidebar trigger.",
  ],
  [
    "playground-inbox",
    "Mobile list replaces the desktop resizable list/thread panes.",
  ],
  [
    "playground-ivr-editor",
    "FlowPanel replaces the desktop aside with a mobile sheet.",
  ],
  [
    "playground-voice-bot-detail",
    "Mobile Settings trigger replaces the desktop settings rail.",
  ],
])

export function a11yScanMode(scene: {
  screen: string
  theme: "light" | "dark"
  width: number
}): "full" | "theme" | "skip" {
  if (scene.width === 390)
    return A11Y_MOBILE_STATES.has(scene.screen) ? "full" : "skip"
  return scene.theme === "light" ? "full" : "theme"
}

export function blocksA11yTour(
  finding: { ruleId: string; impact: string | null },
  allowlist: ReadonlySet<string> = A11Y_RULE_ALLOWLIST
): boolean {
  return (
    !allowlist.has(finding.ruleId) &&
    (finding.impact === "critical" || finding.impact === "serious")
  )
}
