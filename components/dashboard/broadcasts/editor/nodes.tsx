import type { CSSProperties } from "react"
import { Img, Link, Section, Text } from "@react-email/components"
import { EmailNode, type EmailNodeConfig } from "@react-email/editor/core"
import type { useEditorImage } from "@react-email/editor/plugins"
import { mergeAttributes } from "@tiptap/core"

import { formatVariable } from "@/lib/dashboard/email-variables"
import {
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from "@/lib/dashboard/youtube"

/* The blocks the engine does not ship. Each one says how it looks while
   editing (`renderHTML`) and what it becomes in the sent email
   (`renderToReactEmail`), built from React Email's own components. Like the
   engine's nodes they carry a `node-*` class, and the editing look of those
   classes lives with the other document rules in `globals.css`. They are
   inserted as plain content, so none of them needs a command of its own. */

function alignMargin(alignment: unknown): string {
  if (alignment === "center") return "0 auto"
  return alignment === "right" ? "0 0 0 auto" : "0"
}

/* What an empty media block shows until it is given something to show. */
function placeholder(text: string) {
  return ["div", { class: "node-placeholder-box" }, text] as const
}

/** A style object as the inline `style` string the editor's DOM takes. */
function inlineStyle(style: CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      return `${name}:${typeof value === "number" ? `${value}px` : value}`
    })
    .join(";")
}

/* --------------------------------------------------------------- variable */

/** A merge tag as one unit, so it cannot be half-deleted into broken syntax.
    It is sent as the same `{{{name|fallback}}}` text a hand-typed one is. */
const Variable = EmailNode.create({
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
        class: "node-variable",
      },
      formatVariable(node.attrs.name, node.attrs.fallback),
    ]
  },
  renderText({ node }) {
    return formatVariable(node.attrs.name, node.attrs.fallback)
  },
  renderToReactEmail({ node }) {
    return formatVariable(node.attrs?.name ?? "", node.attrs?.fallback ?? "")
  },
})

/* ---------------------------------------------------------------- youtube */

/** Email cannot play video, so this is the video's thumbnail linking out. */
const Youtube = EmailNode.create({
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
          alt: element.getAttribute("data-alt") ?? "Watch on YouTube",
          width: Number(element.getAttribute("data-width")) || 536,
          alignment: element.getAttribute("data-alignment") ?? "center",
        }),
      },
    ]
  },
  renderHTML({ node }) {
    const id = youtubeVideoId(node.attrs.video)
    return [
      "div",
      {
        /* Every attribute, so a copied block pastes back as it was. */
        "data-youtube": node.attrs.video,
        "data-alt": node.attrs.alt,
        "data-width": node.attrs.width,
        "data-alignment": node.attrs.alignment,
        class: "node-youtube",
      },
      id
        ? [
            "img",
            {
              src: youtubeThumbnailUrl(id),
              alt: node.attrs.alt,
              style: inlineStyle({
                display: "block",
                maxWidth: "100%",
                width: node.attrs.width,
                margin: alignMargin(node.attrs.alignment),
              }),
            },
          ]
        : placeholder("Add a YouTube link in the side panel"),
    ]
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

const Spacer = EmailNode.create({
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
        style: inlineStyle({ height: node.attrs.height }),
      },
    ]
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

/** Hand-written markup, sent exactly as written. While editing it is shown
    in a fully closed sandbox, the same way the email preview is: its styles
    cannot reach the dashboard and nothing in it can run. */
const RawHtml = EmailNode.create({
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
        getAttrs: (element) => ({
          code: element.getAttribute("data-raw-html") ?? "",
        }),
      },
    ]
  },
  renderHTML({ node }) {
    /* The markup rides in the attribute, as text, so a copied block keeps
       it without it ever being parsed into the clipboard's document. */
    return ["div", { "data-raw-html": node.attrs.code }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div")
      dom.className = "node-html"
      const frame = document.createElement("iframe")
      frame.setAttribute("sandbox", "")
      frame.title = "HTML block"
      const hint = document.createElement("div")
      hint.className = "node-placeholder-box"
      hint.textContent = "Write HTML in the side panel"

      let painted: string | null = null
      const paint = (code: string) => {
        if (code === painted) return
        painted = code
        frame.srcdoc = code
        dom.replaceChildren(code.trim() ? frame : hint)
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
  renderToReactEmail({ node }) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: String(node.attrs?.code ?? "") }}
      />
    )
  },
})

/* ----------------------------------------------------------------- footer */

/* A footer reads as small print unless the block says otherwise. The theme
   has no footer group to put this in, so the default lives with the node. */
const FOOTER_STYLE: CSSProperties = {
  fontSize: 12,
  lineHeight: "18px",
  color: "#6b7280",
  textAlign: "center",
}

/** The closing note with the opt-out link. */
const Footer = EmailNode.create({
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
          style: inlineStyle(FOOTER_STYLE),
        },
        HTMLAttributes
      ),
      0,
    ]
  },
  renderToReactEmail({ children, style }) {
    return (
      <Section>
        <Text style={{ ...FOOTER_STYLE, ...style }}>{children}</Text>
      </Section>
    )
  },
})

/* ------------------------------------------------------------------ image */

/** The engine's image, with its alignment honoured. The engine stores an
    alignment on every image but exports none of it, so a picture centred on
    the canvas was sent hard against the left edge. */
type Bare = Record<string, never>

export function alignedImage(image: ReturnType<typeof useEditorImage>) {
  /* Spelled out because the default the library declares for this type
     argument is not the one TypeScript settles on. */
  return image.extend<Bare, Bare, EmailNodeConfig<Bare, Bare>>({
    renderToReactEmail({ node, style }) {
      const width = node.attrs?.width
      const height = node.attrs?.height
      const img = (
        <Img
          src={node.attrs?.src ?? ""}
          alt={node.attrs?.alt ?? ""}
          width={width === "auto" ? undefined : width}
          height={height === "auto" ? undefined : height}
          style={{
            ...style,
            display: "block",
            margin: alignMargin(node.attrs?.alignment),
          }}
        />
      )
      return node.attrs?.href ? <Link href={node.attrs.href}>{img}</Link> : img
    },
  })
}

export const CUSTOM_NODES = [Variable, Youtube, Spacer, RawHtml, Footer]
