import { Img, Link, Section, Text } from "@react-email/components"
import { EmailNode } from "@react-email/editor/core"
import { mergeAttributes } from "@tiptap/core"

import {
  formatVariable,
  UNSUBSCRIBE_VARIABLE,
} from "@/lib/dashboard/email-variables"
import {
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from "@/lib/dashboard/youtube"

/* The blocks the engine does not ship. Each one says how it looks while
   editing (`renderHTML`) and what it becomes in the sent email
   (`renderToReactEmail`), built from React Email's own components. */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    opensend: {
      insertVariable: (attrs: { name: string; fallback: string }) => ReturnType
      insertYoutube: () => ReturnType
      insertSpacer: () => ReturnType
      insertHtml: () => ReturnType
      insertFooter: () => ReturnType
      insertSocialLinks: () => ReturnType
    }
  }
}

function alignMargin(alignment: unknown): string {
  if (alignment === "center") return "0 auto"
  return alignment === "right" ? "0 0 0 auto" : "0"
}

/* --------------------------------------------------------------- variable */

/** A merge tag as one unit, so it cannot be half-deleted into broken syntax.
    It is sent as the same `{{{name|fallback}}}` text a hand-typed one is. */
export const Variable = EmailNode.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: "" }, fallback: { default: "" } }
  },
  parseHTML() {
    return [
      {
        tag: "span[data-variable]",
        getAttrs: (element) => ({
          name: element.getAttribute("data-variable") ?? "",
          fallback: element.getAttribute("data-fallback") ?? "",
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-variable": node.attrs.name,
        "data-fallback": node.attrs.fallback,
        class:
          "rounded bg-[#eef2ff] px-1 py-0.5 font-mono text-[0.85em] text-[#3730a3]",
      },
      formatVariable(node.attrs.name, node.attrs.fallback),
    ]
  },
  renderText({ node }) {
    return formatVariable(node.attrs.name, node.attrs.fallback)
  },
  addCommands() {
    return {
      insertVariable:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
  renderToReactEmail({ node }) {
    return formatVariable(node.attrs?.name ?? "", node.attrs?.fallback ?? "")
  },
})

/* ---------------------------------------------------------------- youtube */

/** Email cannot play video, so this is the video's thumbnail linking out. */
export const Youtube = EmailNode.create({
  name: "youtube",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      video: { default: "" },
      alt: { default: "Watch on YouTube" },
      width: { default: 536 },
      alignment: { default: "center" },
    }
  },
  parseHTML() {
    return [
      {
        tag: "div[data-youtube]",
        getAttrs: (element) => ({
          video: element.getAttribute("data-youtube") ?? "",
        }),
      },
    ]
  },
  renderHTML({ node }) {
    const id = youtubeVideoId(node.attrs.video)
    const frame = {
      "data-youtube": node.attrs.video,
      class: "node-youtube py-1",
    }
    if (!id) {
      return [
        "div",
        frame,
        [
          "div",
          {
            class:
              "rounded-md border border-dashed border-[#d4d4d4] p-6 text-center text-sm text-[#737373]",
          },
          "Add a YouTube link in the side panel",
        ],
      ]
    }
    return [
      "div",
      frame,
      [
        "img",
        {
          src: youtubeThumbnailUrl(id),
          alt: node.attrs.alt,
          style: `display:block;max-width:100%;width:${node.attrs.width}px;margin:${alignMargin(node.attrs.alignment)}`,
        },
      ],
    ]
  },
  addCommands() {
    return {
      insertYoutube:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
  renderToReactEmail({ node }) {
    const id = youtubeVideoId(String(node.attrs?.video ?? ""))
    if (!id) return null
    return (
      <Link href={youtubeWatchUrl(id)}>
        <Img
          src={youtubeThumbnailUrl(id)}
          alt={node.attrs?.alt ?? ""}
          width={node.attrs?.width}
          style={{
            display: "block",
            maxWidth: "100%",
            height: "auto",
            margin: alignMargin(node.attrs?.alignment),
          }}
        />
      </Link>
    )
  },
})

/* ----------------------------------------------------------------- spacer */

export const Spacer = EmailNode.create({
  name: "spacer",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { height: { default: 24 } }
  },
  parseHTML() {
    return [
      {
        tag: "div[data-spacer]",
        getAttrs: (element) => ({
          height: Number(element.getAttribute("data-spacer")) || 24,
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-spacer": node.attrs.height,
        class: "node-spacer",
        style: `height:${node.attrs.height}px`,
      },
    ]
  },
  addCommands() {
    return {
      insertSpacer:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
  renderToReactEmail({ node }) {
    const height = Number(node.attrs?.height) || 24
    return (
      <div style={{ height, lineHeight: `${height}px`, fontSize: 1 }}>
        &nbsp;
      </div>
    )
  },
})

/* ------------------------------------------------------------------- html */

/* Markup from the author, shown in their own editor: scripts and inline
   handlers are dropped so a pasted snippet cannot run here. */
function inertHtml(code: string): string {
  const doc = new DOMParser().parseFromString(code, "text/html")
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(element.tagName)) {
      element.remove()
      continue
    }
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith("on")) element.removeAttribute(attr.name)
    }
  }
  return doc.body.innerHTML
}

/** Hand-written markup, sent exactly as written. */
export const RawHtml = EmailNode.create({
  name: "html",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { code: { default: "" } }
  },
  parseHTML() {
    return [
      {
        tag: "div[data-raw-html]",
        getAttrs: (element) => ({ code: element.innerHTML }),
      },
    ]
  },
  renderHTML() {
    return ["div", { "data-raw-html": "" }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div")
      dom.className = "node-html"
      const paint = (code: string) => {
        dom.innerHTML = code.trim()
          ? inertHtml(code)
          : '<div class="rounded-md border border-dashed border-[#d4d4d4] p-6 text-center text-sm text-[#737373]">Write HTML in the side panel</div>'
      }
      paint(node.attrs.code)
      return {
        dom,
        update: (next) => {
          if (next.type.name !== "html") return false
          paint(next.attrs.code)
          return true
        },
      }
    }
  },
  addCommands() {
    return {
      insertHtml:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
  renderToReactEmail({ node }) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: String(node.attrs?.code ?? "") }}
      />
    )
  },
})

/* ----------------------------------------------------------------- footer */

/* A footer reads as small print unless the theme or the block says otherwise. */
const FOOTER_STYLE = {
  fontSize: 12,
  lineHeight: "18px",
  color: "#6b7280",
  textAlign: "center",
} as const

const FOOTER_EDITOR_STYLE =
  "font-size:12px;line-height:18px;color:#6b7280;text-align:center"

/** The closing note with the opt-out link. Its name matches the theme's
    `footer` group, which is where its look comes from. */
export const Footer = EmailNode.create({
  name: "footer",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-footer]" }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      /* Defaults first, so a style set on the block wins over them. */
      mergeAttributes(
        {
          "data-footer": "",
          class: "node-footer",
          style: FOOTER_EDITOR_STYLE,
        },
        HTMLAttributes
      ),
      0,
    ]
  },
  addCommands() {
    return {
      insertFooter:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              {
                type: "text",
                text: "You are receiving this email because you subscribed. ",
              },
              {
                type: "text",
                text: "Unsubscribe",
                marks: [
                  { type: "link", attrs: { href: UNSUBSCRIBE_VARIABLE } },
                ],
              },
            ],
          }),
      /* Not a node of its own: a centred line of links, edited like any text. */
      insertSocialLinks:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: "paragraph",
            attrs: { alignment: "center" },
            content: ["X", "LinkedIn", "GitHub"].flatMap((label, index) => [
              ...(index ? [{ type: "text", text: "  ·  " }] : []),
              {
                type: "text",
                text: label,
                marks: [{ type: "link", attrs: { href: "#" } }],
              },
            ]),
          }),
    }
  },
  renderToReactEmail({ children, style }) {
    return (
      <Section>
        <Text style={{ ...FOOTER_STYLE, ...style }}>{children}</Text>
      </Section>
    )
  },
})

export const CUSTOM_NODES = [Variable, Youtube, Spacer, RawHtml, Footer]
