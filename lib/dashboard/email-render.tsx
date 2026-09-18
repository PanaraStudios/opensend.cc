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
  headingStyleKey,
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
   inline style a block gets is produced here once and reused by both. Theme
   tokens supply the defaults; a block's own fields override them. */

export function spacing(value: BoxSpacing): string {
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`
}

function typography(style: ThemeTextStyle): CSSProperties {
  return {
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight / 100,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textDecoration: style.decoration === "none" ? "none" : style.decoration,
  }
}

function themeOf(theme: EmailTheme, key: ThemeStyleKey): ThemeTextStyle {
  return theme[key]
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
    case "heading": {
      const base = themeOf(theme, headingStyleKey(block.level))
      return {
        ...typography(base),
        margin: 0,
        padding: spacing(block.padding ?? base.padding),
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        textAlign: block.align,
      }
    }
    case "text": {
      const base = themeOf(theme, "text")
      return {
        ...typography(base),
        margin: 0,
        padding: spacing(block.padding),
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        lineHeight: block.lineHeight ?? base.lineHeight / 100,
        textAlign: block.align,
      }
    }
    case "list": {
      const base = themeOf(theme, "text")
      return {
        ...typography(base),
        margin: 0,
        padding: spacing(block.padding),
        paddingInlineStart: 24,
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        textAlign: block.align,
      }
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
    case "table": {
      const base = themeOf(theme, "text")
      return {
        width: "100%",
        borderCollapse: "collapse",
        margin: spacing(block.padding),
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
      }
    }
    case "code": {
      const base = themeOf(theme, "code")
      return {
        ...typography(base),
        fontFamily: MONO_FONT_FAMILY,
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        backgroundColor: block.background,
        borderRadius: `${block.radius}px`,
        padding: spacing(block.padding),
        margin: 0,
        whiteSpace: "pre-wrap",
        overflowX: "auto",
      }
    }
    case "social": {
      const base = themeOf(theme, "link")
      return {
        ...typography(base),
        margin: 0,
        padding: spacing(block.padding),
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        textAlign: block.align,
      }
    }
    case "footer": {
      const base = themeOf(theme, "text")
      return {
        margin: 0,
        padding: spacing(block.padding),
        color: block.color ?? base.color,
        fontSize: `${block.fontSize ?? base.fontSize}px`,
        lineHeight: 1.5,
        textAlign: block.align,
      }
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
          {block.href ? <Link href={block.href}>{img}</Link> : img}
        </div>
      )
    }
    case "youtube": {
      const thumbnail = youtubeThumbnail(block.video)
      if (!thumbnail) return null
      return (
        <div style={blockWrapperStyle(block)}>
          <Link href={youtubeWatchUrl(block.video)}>
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
              <Link href={link.href} style={{ color: style.color }}>
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
          <Link href={UNSUBSCRIBE_VARIABLE} style={{ color: style.color }}>
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
        {doc.globalCss.trim() ? (
          <style dangerouslySetInnerHTML={{ __html: doc.globalCss }} />
        ) : null}
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
