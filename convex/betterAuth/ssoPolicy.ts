/** Lowercased domain part of an email address. */
export function emailDomain(email: string) {
  return email.split("@").pop()?.trim().toLowerCase() ?? ""
}
export function normalizeDomain(domain: string) {
  return domain.trim().replace(/^@/, "").toLowerCase()
}
/** Exact domain match. An empty or missing list matches nothing. */
export function domainAllowed(email: string, domains: string[] | undefined) {
  if (!domains?.length) return false
  const domain = emailDomain(email)
  return !!domain && domains.some((d) => normalizeDomain(d) === domain)
}
/** Installation-approved SSO domains (`SSO_APPROVED_DOMAINS`, comma
    separated). Only the installation administrator sets deployment env. */
export function parseDomains(value: string | undefined) {
  return (value ?? "").split(",").map(normalizeDomain).filter(Boolean)
}
/** Whether SSO may create a brand-new user for this email. A team admin's
    IdP can assert any verified address, so only domains the installation
    approved qualify; everyone else signs up with a verified email and
    password first and links SSO from that signed-in session. */
export function mayProvision(email: string, approvedDomains: string[]) {
  return domainAllowed(email, approvedDomains)
}
