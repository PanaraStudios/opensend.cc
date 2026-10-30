/* The contact search box, through the `contacts.search` full-text index.
   Full-text search matches whole words and word prefixes, so the text holds
   every word a search should find: the email and its parts, the phone's
   digits and their endings, and the names. Pure, so the writers, the
   backfill and the query build and match it the same way. */

export type ContactSearchFields = {
  email?: string
  phone?: string
  firstName: string
  lastName: string
}

/** The shortest phone ending that is a word of its own. */
export const PHONE_ENDING_MIN = 4
/** Convex reads at most 16 terms of a search. */
const MAX_TERMS = 16

/** Split as Convex's tokenizer does: on anything not a letter or digit. */
export const searchWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)

/** Every ending of the E.164 digits from 4 digits up, as words. A national
    number in any country is one of them, and any run of 4 or more digits
    inside the number is a prefix of one. */
export function phoneEndings(phone?: string) {
  const digits = phone?.replace(/\D/g, "") ?? ""
  const endings = []
  for (let n = PHONE_ENDING_MIN; n < digits.length; n++)
    endings.push(digits.slice(-n))
  return endings
}

export const searchText = (contact: ContactSearchFields) =>
  [
    contact.email,
    contact.email?.replace(/[@._+-]+/g, " "),
    contact.phone,
    contact.phone?.slice(1),
    ...phoneEndings(contact.phone),
    contact.firstName,
    contact.lastName,
  ].join(" ")

/** What the box asks for. A phone number, however it is formatted, is one
    run of digits (`digits`). A run that reads as a number dialled from
    abroad ("00" and 4+ digits) or at home (a trunk "0" and 6+ digits) has
    those zeros stripped (`national`), as stored numbers never start with
    them. Any shorter run starting with 0 is taken as typed: it is an ending
    such as "0123", not a prefix to drop. Anything else is words, all of
    which must match. */
export type ContactSearch =
  | { kind: "phone"; digits: string; national: string }
  | { kind: "words"; words: string[] }

const nationalRun = (digits: string) =>
  /^00[1-9]\d{3,}$/.test(digits)
    ? digits.slice(2)
    : /^0[1-9]\d{5,}$/.test(digits)
      ? digits.slice(1)
      : digits

export function parseContactSearch(search: string): ContactSearch {
  const value = search.trim()
  if (/^\+?[\d\s().-]+$/.test(value) && /\d/.test(value)) {
    const digits = value.replace(/\D/g, "")
    const national = value.startsWith("+") ? digits : nationalRun(digits)
    return { kind: "phone", digits, national }
  }
  return { kind: "words", words: searchWords(value).slice(0, MAX_TERMS) }
}

/** The text handed to the full-text index; empty when nothing searchable.
    Convex matches only the LAST term as a prefix and every other term as a
    whole word, so the last term must be one that every true match starts a
    word with: any of the words (each must match), or a phone's `national`
    run. convex-test prefix-matches every term and cannot catch a wrong
    order; contact-search.test.ts checks it against Convex's rule. */
export function searchQuery(search: ContactSearch) {
  if (search.kind === "words") return search.words.join(" ")
  return search.national === search.digits
    ? search.digits
    : `${search.digits} ${search.national}`
}

/** Whether the contact is one the box asks for: a word search needs every
    word as the start of one of the contact's words; a phone search needs a
    word starting with its national run, or the run as typed as a whole
    word. Exactly what the full-text index can return, so the list and an
    export agree. */
export function matchesContactSearch(
  search: ContactSearch,
  contact: ContactSearchFields
) {
  const words = searchWords(searchText(contact))
  const has = (term: string) => words.some((word) => word.startsWith(term))
  return search.kind === "phone"
    ? has(search.national) || words.includes(search.digits)
    : search.words.length > 0 && search.words.every(has)
}
