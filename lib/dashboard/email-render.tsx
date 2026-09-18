import type { CSSProperties, ReactElement } from "react"
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components"
import { render } from "@react-email/render"

import {
  documentRawHtml,
  MONO_FONT_FAMILY,
  UNSUBSCRIBE_VARIABLE,
  youtubeVideoId,
  type BoxSpacing,
  type EmailBlock,
  type EmailDocument,
  type EmailLeafBlock,
  type EmailTheme,
  type ThemeStyleKey,
  type ThemeTextStyle,
} from "./email-document"

/* The editor canvas and the email itself must agree pixel for pixel, so every
   style either of them uses is produced here once and shared.

   Typography is a cascade, not a pile of inline styles:

     theme stylesheet  <  the document's Global CSS  <  a block's own override

   The theme therefore ships as real CSS rules (`themeCss`) emitted into the
   document's `<head>` ahead of the author's Global CSS, and only values the
   author set on one particular block stay inline, where they outrank both.
   Trade-off: a handful of email clients strip `<style>`, and there the theme
   falls back to the client's own defaults. Predictable Global CSS is worth
   more here than squeezing past those clients. */

export function spacing(value: BoxSpacing): string {
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

/* React Email's `Text` and `Link` merge their own inline defaults (14px/24px
   text, blue undecorated links) under whatever style they are handed. Passing
   these keys as explicit `undefined` makes that spread drop the default, so
   the stylesheet decides instead. */
const THEME_OWNED: CSSProperties = {
  color: undefined,
  fontSize: undefined,
  fontWeight: undefined,
  lineHeight: undefined,
  letterSpacing: undefined,
  textDecoration: undefined,
  textDecorationLine: undefined,
  marginTop: undefined,
  marginBottom: undefined,
}

/** Inline style for a link whose colour the theme owns, unless the block
    overrides it. */
function linkStyle(color?: string): CSSProperties {
  return { ...THEME_OWNED, color }
}

function px(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}px`
}

function declarations(style: ThemeTextStyle): string[] {
  return [
    `color: ${style.color}`,
    `font-size: ${style.fontSize}px`,
    `font-weight: ${style.fontWeight}`,
    `line-height: ${style.lineHeight / 100}`,
    `letter-spacing: ${style.letterSpacing}px`,
    `text-decoration: ${style.decoration}`,
  ]
}

/** The theme as a stylesheet. `scope` prefixes every selector, which is how
    the canvas keeps these rules off the rest of the dashboard. */
export function themeCss(theme: EmailTheme, scope = ""): string {
  function rule(selector: string, decls: string[]): string {
    const selectors = selector
      .split(", ")
      .map((one) => (scope ? `${scope} ${one}` : one))
      .join(", ")
    return `${selectors} { ${decls.join("; ")}; }`
  }

  function headingRule(key: ThemeStyleKey, selector: string): string {
    const style = theme[key]
    return rule(selector, [
      ...declarations(style),
      `padding: ${spacing(style.padding)}`,
      "margin: 0",
    ])
  }

  return [
    rule("p", [...declarations(theme.text), "margin: 0"]),
    rule("ul, ol", [...declarations(theme.text), "margin: 0"]),
    /* Restated because the dashboard's CSS reset strips list markers, and the
       canvas has to look like the email, which has no reset. */
    rule("ul", ["list-style-type: disc"]),
    rule("ol", ["list-style-type: decimal"]),
    rule("li", declarations(theme.text)),
    headingRule("title", "h1"),
    headingRule("subtitle", "h2"),
    headingRule("heading", "h3"),
    rule("a", declarations(theme.link)),
    rule("pre, code", [
      ...declarations(theme.code),
      `font-family: ${MONO_FONT_FAMILY}`,
      "margin: 0",
    ]),
  ].join("\n")
}

/** Theme rules first, the author's Global CSS second, so theirs wins. */
export function documentCss(doc: EmailDocument, scope = ""): string {
  const css = doc.globalCss.trim()
  if (!css) return themeCss(doc.theme, scope)
  /* Nesting keeps the author's own selectors intact — including at-rules —
     while still confining them to the paper on the canvas. */
  const scoped = scope ? `${scope} { ${css} }` : css
  return `${themeCss(doc.theme, scope)}\n${scoped}`
}

export function pageStyle(doc: EmailDocument): CSSProperties {
  return {
    backgroundColor: doc.style.page.background,
    padding: spacing(doc.style.page.padding),
    margin: 0,
    fontFamily: doc.style.body.fontFamily,
  }
}

export function bodyStyle(doc: EmailDocument): CSSProperties {
  const body = doc.style.body
  return {
    width: "100%",
    maxWidth: `${body.width}px`,
    backgroundColor: body.background,
    color: body.color,
    borderRadius: `${body.radius}px`,
    border:
      body.borderWidth > 0
        ? `${body.borderWidth}px solid ${body.borderColor}`
        : undefined,
    padding: spacing(body.padding),
    margin: spacing(body.margin),
    textAlign: body.align,
  }
}

export function blockStyle(
  block: EmailBlock,
  theme: EmailTheme
): CSSProperties {
  switch (block.type) {
    case "heading":
      return {
        ...THEME_OWNED,
        padding: block.padding ? spacing(block.padding) : undefined,
        textAlign: block.align,
        color: block.color,
        fontSize: px(block.fontSize),
      }
    case "text":
      return {
        ...THEME_OWNED,
        padding: spacing(block.padding),
        textAlign: block.align,
        color: block.color,
        fontSize: px(block.fontSize),
        lineHeight: block.lineHeight,
      }
    case "list":
      return {
        ...THEME_OWNED,
        padding: spacing(block.padding),
        paddingInlineStart: 24,
        textAlign: block.align,
        color: block.color,
        fontSize: px(block.fontSize),
      }
    case "button":
      return {
        display: block.fullWidth ? "block" : "inline-block",
        backgroundColor: block.background,
        color: block.color,
        borderRadius: `${block.radius}px`,
        fontSize: `${block.fontSize}px`,
        fontWeight: 500,
        lineHeight: 1.2,
        padding: spacing(block.padding),
        textAlign: "center",
        textDecoration: "none",
      }
    case "image":
    case "youtube":
      return {
        display: "block",
        width: `${block.width}px`,
        maxWidth: "100%",
        height: "auto",
        border: "0",
        margin:
          block.align === "center"
            ? "0 auto"
            : block.align === "right"
              ? "0 0 0 auto"
              : "0",
      }
    case "divider":
      return {
        width: "100%",
        border: "none",
        borderTop: `${block.thickness}px solid ${block.color}`,
        margin: spacing(block.padding),
      }
    case "spacer":
      return { height: `${block.height}px`, lineHeight: `${block.height}px` }
    case "table":
      /* No tag of a table is in the theme stylesheet — `td` and `th` are also
         React Email's layout scaffolding — so this one resolves the theme
         inline. */
      return {
        width: "100%",
        borderCollapse: "collapse",
        margin: spacing(block.padding),
        color: block.color ?? theme.text.color,
        fontSize: `${block.fontSize ?? theme.text.fontSize}px`,
      }
    case "code":
      return {
        ...THEME_OWNED,
        backgroundColor: block.background,
        borderRadius: `${block.radius}px`,
        padding: spacing(block.padding),
        whiteSpace: "pre-wrap",
        overflowX: "auto",
        color: block.color,
        fontSize: px(block.fontSize),
      }
    case "social":
      return {
        ...THEME_OWNED,
        padding: spacing(block.padding),
        textAlign: block.align,
        color: block.color,
        fontSize: px(block.fontSize),
      }
    case "footer":
      return {
        ...THEME_OWNED,
        padding: spacing(block.padding),
        textAlign: block.align,
        color: block.color,
        fontSize: px(block.fontSize),
      }
    case "columns":
      return {
        width: "100%",
        backgroundColor:
          block.background === "transparent" ? undefined : block.background,
        padding: spacing(block.padding),
      }
    case "html":
      return {}
  }
}

/** Wrapper that carries a leaf block's alignment where the element itself
    cannot (buttons and images are inline-level). */
export function blockWrapperStyle(block: EmailBlock): CSSProperties {
  if (block.type === "button") {
    return { padding: 0, textAlign: block.align }
  }
  if (block.type === "image" || block.type === "youtube") {
    return { padding: spacing(block.padding), textAlign: block.align }
  }
  return {}
}

export function youtubeThumbnail(video: string): string {
  const id = youtubeVideoId(video)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : ""
}

export function youtubeWatchUrl(video: string): string {
  const id = youtubeVideoId(video)
  return id ? `https://www.youtube.com/watch?v=${id}` : ""
}

function renderLeaf(
  block: EmailLeafBlock,
  theme: EmailTheme
): ReactElement | null {
  const style = blockStyle(block, theme)
  switch (block.type) {
    case "heading":
      return (
        <Heading
          as={`h${block.level}` as "h1" | "h2" | "h3"}
          className={block.className}
          style={style}
        >
          {block.text}
        </Heading>
      )
    case "text":
      return (
        <Text
          className={block.className}
          style={style}
          dangerouslySetInnerHTML={{ __html: block.html || "&nbsp;" }}
        />
      )
    case "list": {
      const List = block.ordered ? "ol" : "ul"
      return (
        <List className={block.className} style={style}>
          {block.items.map((item, index) => (
            <li key={index} dangerouslySetInnerHTML={{ __html: item }} />
          ))}
        </List>
      )
    }
    case "button":
      return (
        <div style={blockWrapperStyle(block)}>
          <Button href={block.href} className={block.className} style={style}>
            {block.label}
          </Button>
        </div>
      )
    case "image": {
      const img = (
        <Img
          src={block.src}
          alt={block.alt}
          className={block.className}
          style={style}
        />
      )
      return (
        <div style={blockWrapperStyle(block)}>
          {block.href ? (
            <Link href={block.href} style={linkStyle()}>
              {img}
            </Link>
          ) : (
            img
          )}
        </div>
      )
    }
    case "youtube": {
      const thumbnail = youtubeThumbnail(block.video)
      if (!thumbnail) return null
      return (
        <div style={blockWrapperStyle(block)}>
          <Link href={youtubeWatchUrl(block.video)} style={linkStyle()}>
            <Img
              src={thumbnail}
              alt={block.alt}
              className={block.className}
              style={style}
            />
          </Link>
        </div>
      )
    }
    case "divider":
      return <Hr className={block.className} style={style} />
    case "spacer":
      return <div style={style} />
    case "table":
      return (
        <table className={block.className} style={style}>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => {
                  const header = block.headerRow && rowIndex === 0
                  const Cell = header ? "th" : "td"
                  return (
                    <Cell
                      key={cellIndex}
                      style={{
                        border: `1px solid ${block.borderColor}`,
                        padding: "8px 10px",
                        textAlign: "left",
                        fontWeight: header ? 600 : 400,
                      }}
                    >
                      {cell}
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "code":
      return (
        <pre className={block.className} style={style}>
          {block.code}
        </pre>
      )
    case "social":
      return (
        <Text className={block.className} style={style}>
          {block.links.map((link, index) => (
            <span key={link.id}>
              {index > 0 ? (
                <span
                  style={{ display: "inline-block", width: `${block.gap}px` }}
                />
              ) : null}
              <Link href={link.href} style={linkStyle(block.color)}>
                {link.label}
              </Link>
            </span>
          ))}
        </Text>
      )
    case "footer":
      return (
        <Text className={block.className} style={style}>
          {block.text}{" "}
          <Link href={UNSUBSCRIBE_VARIABLE} style={linkStyle(block.color)}>
            {block.unsubscribeLabel}
          </Link>
        </Text>
      )
    case "html":
      return (
        <div
          className={block.className}
          dangerouslySetInnerHTML={{ __html: block.code }}
        />
      )
  }
}

function renderBlock(
  block: EmailBlock,
  theme: EmailTheme
): ReactElement | null {
  if (block.type !== "columns") return renderLeaf(block, theme)
  const width = `${Math.floor(100 / block.columns.length)}%`
  const half = Math.round(block.gap / 2)
  return (
    <Section className={block.className} style={blockStyle(block, theme)}>
      <Row>
        {block.columns.map((column, index) => (
          <Column
            key={column.id}
            style={{
              width,
              verticalAlign: "top",
              paddingLeft: index === 0 ? 0 : half,
              paddingRight: index === block.columns.length - 1 ? 0 : half,
            }}
          >
            {column.blocks.map((child) => (
              <div key={child.id}>{renderLeaf(child, theme)}</div>
            ))}
          </Column>
        ))}
      </Row>
    </Section>
  )
}

/** The document as a React Email tree. Pure: no store, no browser APIs. */
export function renderEmailDocument(
  doc: EmailDocument,
  options: { preview?: string } = {}
): ReactElement {
  return (
    <Html lang="en">
      <Head>
        <style dangerouslySetInnerHTML={{ __html: documentCss(doc) }} />
      </Head>
      {options.preview ? <Preview>{options.preview}</Preview> : null}
      <Body style={pageStyle(doc)}>
        <Container style={bodyStyle(doc)}>
          {doc.blocks.map((block) => (
            <div key={block.id}>{renderBlock(block, doc.theme)}</div>
          ))}
        </Container>
      </Body>
    </Html>
  )
}

/** Email HTML for the preview, the code editor, test sends, and the copy
    stored on the broadcast when it goes out. HTML-mode documents are already
    hand-written markup, so they pass straight through. */
export async function renderEmailHtml(
  doc: EmailDocument,
  options: { preview?: string; pretty?: boolean } = {}
): Promise<string> {
  if (doc.mode === "html") return documentRawHtml(doc)
  return render(renderEmailDocument(doc, options), {
    pretty: options.pretty ?? false,
  })
}
