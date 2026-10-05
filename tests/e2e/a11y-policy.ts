// Only evidenced third-party or deliberate exceptions belong here, with a reason
// beside each rule id. Empty until the Linux tour establishes a justified case.
// Allowlisted rules are still scanned and recorded; only failure gating changes.
export const A11Y_RULE_ALLOWLIST: ReadonlySet<string> = new Set([])

export function blocksA11yTour(
  finding: { ruleId: string; impact: string | null },
  allowlist: ReadonlySet<string> = A11Y_RULE_ALLOWLIST
): boolean {
  return (
    !allowlist.has(finding.ruleId) &&
    (finding.impact === "critical" || finding.impact === "serious")
  )
}
