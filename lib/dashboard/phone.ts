/** Normalize an international number without guessing a country code. */
export function normalizePhone(input: string): string | null {
  const value = input.trim()
  if (!/^\+[\d\s()-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, "")
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
}

/** Meta names an E.164 phone number without its leading plus. */
export const toWaId = (phone: string) => phone.replace(/^\+/, "")
export const fromWaId = (id: string) => `+${toWaId(id)}`
