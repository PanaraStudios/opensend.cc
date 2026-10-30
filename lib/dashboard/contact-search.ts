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
    run of digits; typed with a trunk "0" or an international "00" it is
    also tried without them, as the stored number has neither. Anything
    else is words, all of which must match. */
export type ContactSearch =
  { kind: "phone"; digits: string[] } | { kind: "words"; words: string[] }

export function parseContactSearch(search: string): ContactSearch {
  const value = search.trim()
  if (/^\+?[\d\s().-]+$/.test(value) && /\d/.test(value)) {
    const digits = value.replace(/\D/g, "")
    const national = value.startsWith("+") ? digits : digits.replace(/^0+/, "")
    return {
      kind: "phone",
      digits: national && national !== digits ? [national, digits] : [digits],
    }
  }
  return { kind: "words", words: searchWords(value).slice(0, MAX_TERMS) }
}

/** The text handed to the full-text index; empty when nothing searchable. */
export const searchQuery = (search: ContactSearch) =>
  (search.kind === "phone" ? search.digits : search.words).join(" ")

/** Full-text search ranks rows that match any term. A phone search keeps
    those with one of its digit runs, a word search those with every word,
    each as the start of one of the contact's words. */
export function matchesContactSearch(
  search: ContactSearch,
  contact: ContactSearchFields
) {
  const words = searchWords(searchText(contact))
  const has = (term: string) => words.some((word) => word.startsWith(term))
  return search.kind === "phone"
    ? search.digits.some(has)
    : search.words.length > 0 && search.words.every(has)
}
