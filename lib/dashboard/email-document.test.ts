import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  availableVariables,
  box,
  canDropIn,
  canRedo,
  canUndo,
  columnContainerKey,
  containerBlocks,
  createColumnsBlock,
  createEmailBlock,
  createHistory,
  documentRawHtml,
  documentVariables,
  duplicateBlock,
  emptyEmailDocument,
  findBlock,
  flattenBlocks,
  formatVariable,
  hasUnsubscribeLink,
  headingStyleKey,
  htmlEmailDocument,
  insertBlock,
  isDocumentEmpty,
  moveBlock,
  moveBlockBy,
  normalizeEmailDocument,
  parseContainerKey,
  parseVariables,
  pushHistory,
  redoHistory,
  removeBlock,
  resetThemeStyle,
  ROOT_CONTAINER,
  setColumnCount,
  setDocumentStyle,
  setThemePreset,
  setThemeStyle,
  themePreset,
  undoHistory,
  updateBlock,
  youtubeVideoId,
  type ColumnsBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDocument,
  type HeadingBlock,
  type TextBlock,
} from "./email-document"
import { blockStyle, renderEmailHtml, themeCss } from "./email-render"
import { SEED_STATE } from "./data"

function docWith(...types: EmailBlockType[]): EmailDocument {
  return types.reduce<EmailDocument>(
    (doc, type, index) =>
      insertBlock(doc, createEmailBlock(type), ROOT_CONTAINER, index),
    emptyEmailDocument()
  )
}

describe("createEmailBlock", () => {
  it("gives every type a distinct id and its own defaults", () => {
    const heading = createEmailBlock("heading") as HeadingBlock
    const text = createEmailBlock("text") as TextBlock
    assert.notEqual(heading.id, text.id)
    assert.equal(heading.level, 3)
    assert.equal(text.html, "")
  })

  it("leaves typography unset so blocks inherit the theme", () => {
    const heading = createEmailBlock("heading") as HeadingBlock
    assert.equal(heading.color, undefined)
    assert.equal(heading.fontSize, undefined)
  })

  it("starts a columns block with two empty columns", () => {
    const columns = createEmailBlock("columns", "blk_x") as ColumnsBlock
    assert.equal(columns.columns.length, 2)
    assert.deepEqual(
      columns.columns.map((column) => column.blocks),
      [[], []]
    )
  })

  it("builds a columns block of any supported width", () => {
    assert.equal(createColumnsBlock(1).columns.length, 1)
    assert.equal(createColumnsBlock(4).columns.length, 4)
  })
})

describe("container keys", () => {
  it("round-trips a column key", () => {
    const key = columnContainerKey("blk_a", 2)
    assert.deepEqual(parseContainerKey(key), {
      blockId: "blk_a",
      columnIndex: 2,
    })
  })

  it("treats the root key as no parent", () => {
    assert.equal(parseContainerKey(ROOT_CONTAINER), null)
  })
})

describe("insertBlock", () => {
  it("inserts at the requested index and clamps out-of-range ones", () => {
    const doc = docWith("heading", "text")
    const next = insertBlock(
      doc,
      createEmailBlock("spacer"),
      ROOT_CONTAINER,
      99
    )
    assert.deepEqual(
      next.blocks.map((block) => block.type),
      ["heading", "text", "spacer"]
    )
  })

  it("refuses to nest columns inside a column", () => {
    const doc = docWith("columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    assert.equal(canDropIn("columns", key), false)
    const next = insertBlock(doc, createEmailBlock("columns"), key, 0)
    assert.equal(containerBlocks(next, key).length, 0)
  })

  it("adds a leaf to a column", () => {
    const doc = docWith("columns")
    const first = columnContainerKey(doc.blocks[0]!.id, 0)
    const second = columnContainerKey(doc.blocks[0]!.id, 1)
    const next = insertBlock(doc, createEmailBlock("text"), second, 0)
    assert.equal(containerBlocks(next, second).length, 1)
    assert.equal(containerBlocks(next, first).length, 0)
  })
})

describe("findBlock", () => {
  it("locates a nested block by its column", () => {
    const doc = docWith("columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 1)
    const text = createEmailBlock("text")
    const next = insertBlock(doc, text, key, 0)
    assert.deepEqual(findBlock(next, text.id), {
      block: text,
      container: key,
      index: 0,
    })
  })

  it("returns null for an unknown id", () => {
    assert.equal(findBlock(docWith("text"), "nope"), null)
  })
})

describe("moveBlock", () => {
  it("reorders within the root list", () => {
    const doc = docWith("heading", "text", "divider")
    const next = moveBlock(doc, doc.blocks[2]!.id, ROOT_CONTAINER, 0)
    assert.deepEqual(
      next.blocks.map((block) => block.type),
      ["divider", "heading", "text"]
    )
  })

  it("drops a block at the end of its own list", () => {
    const doc = docWith("heading", "text", "divider")
    const next = moveBlock(doc, doc.blocks[0]!.id, ROOT_CONTAINER, 2)
    assert.deepEqual(
      next.blocks.map((block) => block.type),
      ["text", "divider", "heading"]
    )
  })

  it("moves a block from the root into a column", () => {
    const doc = docWith("columns", "text")
    const text = doc.blocks[1]!
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    const next = moveBlock(doc, text.id, key, 0)
    assert.equal(next.blocks.length, 1)
    assert.deepEqual(
      containerBlocks(next, key).map((block) => block.id),
      [text.id]
    )
  })

  it("leaves the document alone when the drop is illegal", () => {
    const doc = docWith("columns", "columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    assert.equal(moveBlock(doc, doc.blocks[1]!.id, key, 0), doc)
  })
})

describe("moveBlockBy", () => {
  it("steps a block up and stops at the edges", () => {
    const doc = docWith("heading", "text")
    const up = moveBlockBy(doc, doc.blocks[1]!.id, -1)
    assert.deepEqual(
      up.blocks.map((block) => block.type),
      ["text", "heading"]
    )
    assert.equal(moveBlockBy(doc, doc.blocks[0]!.id, -1), doc)
  })
})

describe("duplicateBlock", () => {
  it("copies a block after the original with new ids", () => {
    const doc = docWith("heading")
    const { doc: next, id } = duplicateBlock(doc, doc.blocks[0]!.id)
    assert.equal(next.blocks.length, 2)
    assert.notEqual(id, doc.blocks[0]!.id)
    assert.equal(next.blocks[1]!.type, "heading")
  })

  it("gives a duplicated columns block fresh child ids", () => {
    let doc = docWith("columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    const child = createEmailBlock("text")
    doc = insertBlock(doc, child, key, 0)
    const { doc: next, id } = duplicateBlock(doc, doc.blocks[0]!.id)
    const copy = next.blocks[1] as ColumnsBlock
    assert.equal(copy.id, id)
    assert.notEqual(copy.columns[0]!.blocks[0]!.id, child.id)
    assert.equal(flattenBlocks(next).length, 4)
  })
})

describe("removeBlock and updateBlock", () => {
  it("removes a nested block", () => {
    const doc = docWith("columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    const text = createEmailBlock("text")
    const withText = insertBlock(doc, text, key, 0)
    assert.equal(containerBlocks(removeBlock(withText, text.id), key).length, 0)
  })

  it("patches a nested block in place", () => {
    const doc = docWith("columns")
    const key = columnContainerKey(doc.blocks[0]!.id, 0)
    const text = createEmailBlock("text")
    const withText = insertBlock(doc, text, key, 0)
    const next = updateBlock<TextBlock>(withText, text.id, { html: "Hi" })
    assert.equal((containerBlocks(next, key)[0] as TextBlock).html, "Hi")
  })
})

describe("setColumnCount", () => {
  it("adds empty columns when growing", () => {
    const doc = docWith("columns")
    const next = setColumnCount(doc, doc.blocks[0]!.id, 4)
    assert.equal((next.blocks[0] as ColumnsBlock).columns.length, 4)
  })

  it("keeps the blocks of dropped columns", () => {
    let doc = docWith("columns")
    const id = doc.blocks[0]!.id
    doc = insertBlock(
      doc,
      createEmailBlock("text"),
      columnContainerKey(id, 1),
      0
    )
    const next = setColumnCount(doc, id, 1)
    const columns = (next.blocks[0] as ColumnsBlock).columns
    assert.equal(columns.length, 1)
    assert.equal(columns[0]!.blocks.length, 1)
  })
})

describe("setDocumentStyle", () => {
  it("merges page and body patches", () => {
    const doc = setDocumentStyle(emptyEmailDocument(), {
      page: { background: "#000000" },
      body: { width: 480 },
    })
    assert.equal(doc.style.page.background, "#000000")
    assert.equal(doc.style.body.width, 480)
    assert.equal(doc.style.body.background, "#ffffff")
  })
})

describe("theme", () => {
  it("ships the minimal preset the panel documents", () => {
    const theme = themePreset("minimal")
    assert.equal(theme.text.fontSize, 14)
    assert.equal(theme.text.lineHeight, 155)
    assert.equal(theme.title.fontSize, 31)
    assert.equal(theme.subtitle.fontSize, 25)
    assert.equal(theme.heading.fontSize, 19)
    assert.equal(theme.title.fontWeight, 600)
  })

  it("maps heading levels onto theme entries", () => {
    assert.equal(headingStyleKey(1), "title")
    assert.equal(headingStyleKey(2), "subtitle")
    assert.equal(headingStyleKey(3), "heading")
  })

  it("patches and resets a single group", () => {
    const doc = setThemeStyle(emptyEmailDocument(), "title", { fontSize: 40 })
    assert.equal(doc.theme.title.fontSize, 40)
    assert.equal(doc.theme.text.fontSize, 14)
    assert.equal(resetThemeStyle(doc, "title").theme.title.fontSize, 31)
  })

  it("swaps every group when the preset changes", () => {
    const doc = setThemePreset(emptyEmailDocument(), "basic")
    assert.equal(doc.theme.preset, "basic")
    assert.equal(doc.theme.text.fontSize, 16)
  })
})

describe("history", () => {
  it("undoes and redoes document edits", () => {
    const first = emptyEmailDocument()
    const second = docWith("text")
    let history = createHistory(first)
    assert.equal(canUndo(history), false)
    history = pushHistory(history, second)
    assert.equal(history.present, second)
    assert.equal(canUndo(history), true)
    history = undoHistory(history)
    assert.equal(history.present, first)
    assert.equal(canRedo(history), true)
    history = redoHistory(history)
    assert.equal(history.present, second)
  })

  it("drops the redo stack after a new edit", () => {
    let history = createHistory(emptyEmailDocument())
    history = pushHistory(history, docWith("text"))
    history = undoHistory(history)
    history = pushHistory(history, docWith("heading"))
    assert.equal(canRedo(history), false)
  })
})

describe("variables", () => {
  it("formats with and without a fallback", () => {
    assert.equal(
      formatVariable("contact.first_name"),
      "{{{contact.first_name}}}"
    )
    assert.equal(
      formatVariable("contact.first_name", "there"),
      "{{{contact.first_name|there}}}"
    )
  })

  it("parses dotted names and the legacy upper-case ones", () => {
    assert.deepEqual(
      parseVariables("Hi {{{contact.first_name|there}}}, {{{FIRST_NAME}}}"),
      [
        { name: "contact.first_name", fallback: "there" },
        { name: "FIRST_NAME", fallback: "" },
      ]
    )
  })

  it("offers the built-ins plus every contact property", () => {
    const names = availableVariables(SEED_STATE.properties).map(
      (variable) => variable.name
    )
    assert.ok(names.includes("contact.first_name"))
    assert.ok(names.includes("contact.company"))
    assert.ok(names.includes("OPENSEND_UNSUBSCRIBE_URL"))
    assert.equal(new Set(names).size, names.length)
  })

  it("collects the variables a document uses", () => {
    let doc = docWith("text")
    doc = updateBlock<TextBlock>(doc, doc.blocks[0]!.id, {
      html: "Hi {{{contact.first_name|there}}}",
    })
    assert.deepEqual(documentVariables(doc), ["contact.first_name"])
  })

  it("counts a footer block as an unsubscribe link", () => {
    assert.equal(hasUnsubscribeLink(docWith("text")), false)
    assert.equal(hasUnsubscribeLink(docWith("footer")), true)
    assert.equal(
      hasUnsubscribeLink(
        htmlEmailDocument("<a href='{{{OPENSEND_UNSUBSCRIBE_URL}}}'>x</a>")
      ),
      true
    )
  })
})

describe("youtubeVideoId", () => {
  it("reads an id out of every common YouTube URL", () => {
    assert.equal(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
    assert.equal(
      youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    )
    assert.equal(youtubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ")
    assert.equal(youtubeVideoId("not a video"), "")
  })
})

describe("html documents", () => {
  it("wraps raw markup as a single html block", () => {
    const doc = htmlEmailDocument("<p>Hello</p>")
    assert.equal(doc.mode, "html")
    assert.equal(doc.blocks.length, 1)
    assert.equal(documentRawHtml(doc), "<p>Hello</p>")
  })

  it("treats blank markup as an empty document", () => {
    assert.equal(isDocumentEmpty(htmlEmailDocument("   ")), true)
    assert.equal(isDocumentEmpty(htmlEmailDocument("<p>x</p>")), false)
  })

  it("keeps the theme and page style of the document it replaces", () => {
    const base = setThemePreset(emptyEmailDocument(), "basic")
    assert.equal(htmlEmailDocument("<p>x</p>", base).theme.preset, "basic")
  })
})

describe("normalizeEmailDocument", () => {
  it("falls back to the stored html when there is no content", () => {
    const doc = normalizeEmailDocument(undefined, "<p>Legacy</p>")
    assert.equal(doc.mode, "html")
    assert.equal(documentRawHtml(doc), "<p>Legacy</p>")
  })

  it("backfills fields added after the document was saved", () => {
    const doc = normalizeEmailDocument(
      { blocks: [], style: { body: { width: 520 } }, mode: "visual" },
      ""
    )
    assert.equal(doc.style.body.width, 520)
    assert.equal(doc.style.body.background, "#ffffff")
    assert.deepEqual(doc.style.page.padding, box(24, 12))
    assert.equal(doc.theme.preset, "minimal")
    assert.equal(doc.globalCss, "")
  })

  it("keeps a persisted theme override", () => {
    const doc = normalizeEmailDocument(
      {
        blocks: [],
        style: {},
        mode: "visual",
        theme: { preset: "basic", title: { fontSize: 44 } },
        globalCss: "p { color: red; }",
      },
      ""
    )
    assert.equal(doc.theme.title.fontSize, 44)
    assert.equal(doc.theme.text.fontSize, 16)
    assert.equal(doc.globalCss, "p { color: red; }")
  })
})

describe("themeCss", () => {
  it("writes a rule for every tag the renderer emits", () => {
    const css = themeCss(themePreset("minimal"))
    for (const selector of [
      "p {",
      "ul, ol {",
      "li {",
      "h1 {",
      "h2 {",
      "h3 {",
      "a {",
      "li ul, li ol, li li {",
      "img {",
      "pre {",
      "code {",
    ]) {
      assert.ok(css.includes(selector), `missing rule for ${selector}`)
    }
    assert.match(css, /h1 \{[^}]*font-size: 31px/)
    assert.match(css, /a \{[^}]*text-decoration: underline/)
  })

  it("writes only the values a group exposes", () => {
    const theme = themePreset("minimal")
    theme.image = { ...theme.image, radius: 12, borderWidth: 2 }
    const css = themeCss(theme)
    assert.match(
      css,
      /img \{ border-radius: 12px; border: 2px solid #000000; \}/
    )
    assert.match(css, /pre \{[^}]*background-color: #f5f5f5/)
    assert.doesNotMatch(css, /p \{[^}]*background-color/)
  })

  it("lets a button follow the theme until the block overrides it", () => {
    const theme = themePreset("minimal")
    const button = createEmailBlock("button")
    assert.equal(blockStyle(button, theme).backgroundColor, "#000000")
    theme.button = { ...theme.button, background: "#ff0000" }
    assert.equal(blockStyle(button, theme).backgroundColor, "#ff0000")
    assert.equal(
      blockStyle({ ...button, background: "#00ff00" } as EmailBlock, theme)
        .backgroundColor,
      "#00ff00"
    )
  })

  it("scopes every selector when asked, so the canvas stays contained", () => {
    const css = themeCss(themePreset("minimal"), "#email-paper")
    assert.ok(css.includes("#email-paper p {"))
    assert.ok(css.includes("#email-paper ul, #email-paper ol {"))
    assert.ok(!/^p \{/m.test(css))
  })
})

describe("renderEmailHtml", () => {
  it("renders every block type to email markup", async () => {
    let doc = docWith(
      "heading",
      "text",
      "list",
      "button",
      "image",
      "divider",
      "spacer",
      "table",
      "code",
      "social",
      "footer",
      "columns"
    )
    doc = updateBlock<TextBlock>(doc, doc.blocks[1]!.id, {
      html: "Hi <b>there</b>",
    })
    const html = await renderEmailHtml(doc, { preview: "Peek" })
    assert.match(html, /<html/i)
    assert.match(html, /<h3/i)
    assert.match(html, /Hi <b>there<\/b>/)
    assert.match(html, /<ul/i)
    assert.match(html, /<a[^>]+href="https:\/\/example.com"/)
    assert.match(html, /<img/i)
    assert.match(html, /<hr/i)
    assert.match(html, /<th/i)
    assert.match(html, /<pre/i)
    assert.match(html, /<table/i)
    assert.match(html, /\{\{\{OPENSEND_UNSUBSCRIBE_URL\}\}\}/)
    assert.match(html, /Peek/)
  })

  it("links a YouTube thumbnail instead of embedding a player", async () => {
    let doc = docWith("youtube")
    doc = updateBlock(doc, doc.blocks[0]!.id, { video: "dQw4w9WgXcQ" })
    const html = await renderEmailHtml(doc)
    assert.match(html, /img\.youtube\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/)
    assert.match(html, /youtube\.com\/watch\?v=dQw4w9WgXcQ/)
  })

  it("emits the document's global CSS into the head", async () => {
    const doc = { ...docWith("text"), globalCss: ".example { color: blue; }" }
    const html = await renderEmailHtml(doc)
    assert.match(html, /<style[^>]*>[\s\S]*\.example \{ color: blue; \}/)
  })

  it("puts the theme rules before the author's global CSS", async () => {
    const doc = { ...docWith("text"), globalCss: "p { color: red; }" }
    const html = await renderEmailHtml(doc)
    const theme = html.indexOf("p { color: #000000;")
    const global = html.indexOf("p { color: red; }")
    assert.ok(theme !== -1, "theme rule is missing")
    assert.ok(global !== -1, "global CSS is missing")
    assert.ok(theme < global, "global CSS must come last so it wins")
  })

  it("leaves theme typography off the block, so global CSS can win", async () => {
    const html = await renderEmailHtml(docWith("text"))
    const style = html.match(/<p[^>]*style="([^"]*)"/)?.[1] ?? ""
    assert.ok(style.length > 0, "the paragraph should still be styled")
    assert.doesNotMatch(style, /(^|;)color:/)
    assert.doesNotMatch(style, /(^|;)font-size:/)
    assert.doesNotMatch(style, /(^|;)line-height:/)
  })

  it("keeps a block's own override inline, where it outranks global CSS", async () => {
    let doc = docWith("text")
    doc = updateBlock<TextBlock>(doc, doc.blocks[0]!.id, {
      color: "#ff0000",
      fontSize: 22,
    })
    const style =
      (await renderEmailHtml(doc)).match(/<p[^>]*style="([^"]*)"/)?.[1] ?? ""
    assert.match(style, /color:#ff0000/)
    assert.match(style, /font-size:22px/)
  })

  it("puts a block's CSS class on its element", async () => {
    let doc = docWith("text")
    doc = updateBlock<TextBlock>(doc, doc.blocks[0]!.id, {
      className: "example",
    })
    assert.match(await renderEmailHtml(doc), /<p[^>]*class="example"/)
  })

  it("applies theme typography to headings through the stylesheet", async () => {
    const doc = setThemeStyle(docWith("heading"), "heading", { fontSize: 42 })
    const html = await renderEmailHtml(doc)
    assert.match(html, /h3 \{[^}]*font-size: 42px/)
    const style = html.match(/<h3[^>]*style="([^"]*)"/)?.[1] ?? ""
    assert.doesNotMatch(style, /font-size/)
  })

  it("passes hand-written html through untouched", async () => {
    const html = await renderEmailHtml(htmlEmailDocument("<p>Raw</p>"))
    assert.equal(html, "<p>Raw</p>")
  })
})
