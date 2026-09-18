import type { JSONContent } from "@tiptap/core"

import { UNSUBSCRIBE_VARIABLE } from "@/lib/dashboard/email-variables"

/* Ready-made sections, in the spirit of react.email/components. Each one is
   an ordinary piece of the document, made of the same nodes a person would
   insert one at a time, so every part of it stays editable. */

type Align = "left" | "center" | "right"

function text(value: string, href?: string): JSONContent {
  return href
    ? { type: "text", text: value, marks: [{ type: "link", attrs: { href } }] }
    : { type: "text", text: value }
}

function paragraph(content: JSONContent[], alignment: Align = "left") {
  return { type: "paragraph", attrs: { alignment }, content }
}

function heading(level: 1 | 2 | 3, value: string, alignment: Align = "left") {
  return {
    type: "heading",
    attrs: { level, alignment },
    content: [text(value)],
  }
}

function button(label: string, alignment: Align = "left"): JSONContent {
  return {
    type: "button",
    attrs: { href: "https://example.com", alignment },
    content: [text(label)],
  }
}

function image(src: string, alt: string): JSONContent {
  return { type: "image", attrs: { src, alt, alignment: "center" } }
}

function section(content: JSONContent[], style?: string): JSONContent {
  return { type: "section", attrs: style ? { style } : {}, content }
}

function column(content: JSONContent[]): JSONContent {
  return { type: "columnsColumn", content }
}

const HEADER: JSONContent[] = [
  section([
    paragraph([text("Your brand")], "center"),
    paragraph(
      [
        text("Product", "https://example.com"),
        text("   ·   "),
        text("Pricing", "https://example.com"),
        text("   ·   "),
        text("Blog", "https://example.com"),
      ],
      "center"
    ),
  ]),
]

const HERO: JSONContent[] = [
  section([
    image("https://placehold.co/1072x536/png", "Hero image"),
    heading(1, "Say the one thing that matters", "center"),
    paragraph(
      [text("A sentence or two that tells people why they should care.")],
      "center"
    ),
    button("Get started", "center"),
  ]),
]

const FEATURES: JSONContent[] = [
  {
    type: "twoColumns",
    attrs: { cellspacing: 16 },
    content: [
      column([
        heading(3, "First benefit"),
        paragraph([text("What it does for the reader, in plain words.")]),
      ]),
      column([
        heading(3, "Second benefit"),
        paragraph([text("Another reason to keep reading.")]),
      ]),
    ],
  },
]

const CALL_TO_ACTION: JSONContent[] = [
  section(
    [
      heading(2, "Ready when you are", "center"),
      paragraph([text("One clear next step.")], "center"),
      button("Start now", "center"),
    ],
    "background-color:#f5f5f5;padding-top:32px;padding-right:24px;padding-bottom:32px;padding-left:24px;border-radius:8px"
  ),
]

const SIGN_OFF: JSONContent[] = [
  { type: "horizontalRule" },
  paragraph(
    [
      text("X", "#"),
      text("  ·  "),
      text("LinkedIn", "#"),
      text("  ·  "),
      text("GitHub", "#"),
    ],
    "center"
  ),
  {
    type: "footer",
    content: [
      text("You are receiving this email because you subscribed. "),
      text("Unsubscribe", UNSUBSCRIBE_VARIABLE),
    ],
  },
]

export const PATTERNS = {
  header: HEADER,
  hero: HERO,
  features: FEATURES,
  "call-to-action": CALL_TO_ACTION,
  "sign-off": SIGN_OFF,
} satisfies Record<string, JSONContent[]>
