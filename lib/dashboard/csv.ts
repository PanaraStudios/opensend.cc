import { isEmail } from "./format"

export type CsvTable = {
  headers: string[]
  rows: string[][]
}

const RESERVED_MAP: Record<string, string> = {
  email: "email",
  e_mail: "email",
  "e-mail": "email",
  first_name: "first_name",
  firstname: "first_name",
  "first name": "first_name",
  last_name: "last_name",
  lastname: "last_name",
  "last name": "last_name",
  unsubscribed: "unsubscribed",
  subscribed: "unsubscribed",
}

export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = splitCsvLines(source)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = lines[0].map((header) => header.trim())
  const rows = lines
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => headers.map((_, index) => row[index]?.trim() ?? ""))
  return { headers, rows }
}

export function suggestCsvMapping(
  header: string,
  propertyKeys: readonly string[]
): string {
  const normalized = header.trim().toLowerCase().replace(/\s+/g, "_")
  if (RESERVED_MAP[header.trim().toLowerCase()] || RESERVED_MAP[normalized]) {
    return RESERVED_MAP[header.trim().toLowerCase()] ?? RESERVED_MAP[normalized]
  }
  const match = propertyKeys.find(
    (key) => key === normalized || key === header.trim()
  )
  return match ?? "ignore"
}

export function splitEmails(text: string): string[] {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase()
    if (!email || seen.has(email) || !isEmail(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

export function parseUnsubscribed(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (["true", "1", "yes", "y"].includes(normalized)) return true
  if (["false", "0", "no", "n"].includes(normalized)) return false
  return undefined
}

function splitCsvLines(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }

  if (quoted) {
    throw new Error("Unclosed quoted field in CSV")
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
