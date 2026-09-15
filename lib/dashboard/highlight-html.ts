export type HtmlTokenKind =
  | "text"
  | "tag"
  | "attr"
  | "string"
  | "comment"
  | "punct"

export type HtmlToken = {
  kind: HtmlTokenKind
  value: string
}

const TAG_NAME = /^[A-Za-z][\w:-]*/
const ATTR_NAME = /^[A-Za-z_:][\w:.-]*/
const WHITESPACE = /^\s+/
const UNQUOTED = /^[^\s>]+/

function push(tokens: HtmlToken[], kind: HtmlTokenKind, value: string) {
  if (value) tokens.push({ kind, value })
}

export function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = []
  let i = 0

  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4)
      const close = end === -1 ? source.length : end + 3
      push(tokens, "comment", source.slice(i, close))
      i = close
      continue
    }

    if (source[i] !== "<") {
      const next = source.indexOf("<", i)
      const end = next === -1 ? source.length : next
      push(tokens, "text", source.slice(i, end))
      i = end
      continue
    }

    const tagStart = i
    i += 1
    push(tokens, "punct", "<")

    if (source[i] === "/") {
      push(tokens, "punct", "/")
      i += 1
    } else if (source[i] === "!" || source[i] === "?") {
      const end = source.indexOf(">", i)
      const close = end === -1 ? source.length : end
      push(tokens, "tag", source.slice(i, close))
      i = close
      if (source[i] === ">") {
        push(tokens, "punct", ">")
        i += 1
      }
      continue
    }

    const name = source.slice(i).match(TAG_NAME)
    if (!name) {
      tokens.pop()
      const next = source.indexOf("<", i)
      const end = next === -1 ? source.length : next
      push(tokens, "text", source.slice(tagStart, end))
      i = end
      continue
    }

    push(tokens, "tag", name[0])
    i += name[0].length

    while (i < source.length) {
      const space = source.slice(i).match(WHITESPACE)
      if (space) {
        push(tokens, "text", space[0])
        i += space[0].length
      }

      if (source[i] === ">") {
        push(tokens, "punct", ">")
        i += 1
        break
      }

      if (source.startsWith("/>", i)) {
        push(tokens, "punct", "/>")
        i += 2
        break
      }

      const attr = source.slice(i).match(ATTR_NAME)
      if (!attr) {
        const next = source.indexOf(">", i)
        const end = next === -1 ? source.length : next
        push(tokens, "text", source.slice(i, end))
        i = end
        continue
      }

      push(tokens, "attr", attr[0])
      i += attr[0].length

      const afterName = source.slice(i).match(WHITESPACE)
      if (afterName) {
        push(tokens, "text", afterName[0])
        i += afterName[0].length
      }

      if (source[i] !== "=") continue

      push(tokens, "punct", "=")
      i += 1

      const afterEq = source.slice(i).match(WHITESPACE)
      if (afterEq) {
        push(tokens, "text", afterEq[0])
        i += afterEq[0].length
      }

      const quote = source[i]
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1)
        const end = close === -1 ? source.length : close + 1
        push(tokens, "string", source.slice(i, end))
        i = end
        continue
      }

      const unquoted = source.slice(i).match(UNQUOTED)
      if (unquoted) {
        push(tokens, "string", unquoted[0])
        i += unquoted[0].length
      }
    }
  }

  return tokens
}

export function joinHtmlTokens(tokens: HtmlToken[]): string {
  return tokens.map((token) => token.value).join("")
}
