"use client"

import * as React from "react"
import { StarterKit } from "@react-email/editor/extensions"
import {
  EmailTheming,
  extendTheme,
  useEditorImage,
} from "@react-email/editor/plugins"
import { Placeholder } from "@tiptap/extension-placeholder"
import {
  EditorContext,
  useEditor,
  type Content,
  type Editor,
} from "@tiptap/react"

import {
  alignedImage,
  CUSTOM_NODES,
} from "@/components/dashboard/broadcasts/editor/nodes"

/* The document engine is React Email's editor: its nodes, its theming and its
   export. Everything drawn around it — rail, inspector, menus — is ours, so
   none of its stylesheets or prebuilt menus are imported. */

/* The engine's basic theme, on our page: a soft grey backdrop with the email
   on a white, padded sheet. Basic rather than minimal because minimal sets
   no font, base size or spacing at all, and an email sent without them falls
   back to the mail client's serif with every block touching the next. */
const THEME = extendTheme("basic", {
  body: {
    backgroundColor: "#f5f5f5",
    paddingTop: 24,
    paddingRight: 12,
    paddingBottom: 24,
    paddingLeft: 12,
  },
  container: {
    align: "center",
    width: 600,
    backgroundColor: "#ffffff",
    paddingTop: 32,
    paddingRight: 32,
    paddingBottom: 32,
    paddingLeft: 32,
    borderRadius: 8,
  },
  link: { color: "#2563eb", textDecoration: "underline" },
  button: {
    backgroundColor: "#000000",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    paddingTop: 12,
    paddingRight: 20,
    paddingBottom: 12,
    paddingLeft: 20,
    borderRadius: 8,
  },
  codeBlock: {
    backgroundColor: "#f5f5f5",
    paddingTop: 12,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 14,
    borderRadius: 6,
  },
  inlineCode: {
    backgroundColor: "#e5e7eb",
    color: "#1e293b",
    borderRadius: 4,
  },
  image: { borderRadius: 8 },
})

const BASE_EXTENSIONS = [
  StarterKit.configure(),
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) =>
      node.type.name === "heading"
        ? `Heading ${node.attrs.level}`
        : "Press '/' for commands",
  }),
  EmailTheming.configure({ theme: THEME }),
  ...CUSTOM_NODES,
]

/* There is no file storage behind the dashboard yet, so an uploaded picture
   travels inside the document as a data URL, and the document lives in the
   browser's few megabytes of storage. A photo straight off a phone would fill
   that on its own, so it is drawn down to email width and re-encoded first;
   1200px is twice the widest column, which is enough for a sharp screen. */
const MAX_IMAGE_EDGE = 1200

async function uploadImage(file: File): Promise<{ url: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  /* PNG keeps transparency (logos); photos are far smaller as JPEG. */
  const type = file.type === "image/png" ? "image/png" : "image/jpeg"
  return { url: canvas.toDataURL(type, 0.85) }
}

export function useEmailEngine({
  content,
  onUpdate,
}: {
  content: Content
  onUpdate: (editor: Editor) => void
}): Editor {
  const image = useEditorImage({ uploadImage })
  const extensions = React.useMemo(
    () => [...BASE_EXTENSIONS, alignedImage(image)],
    [image]
  )

  return useEditor({
    extensions,
    content,
    /* The editor screen only ever renders in the browser, after the saved
       state has loaded, so there is no server pass to stay in step with. */
    immediatelyRender: true,
    onUpdate: ({ editor }) => onUpdate(editor),
  })
}

/** Makes the engine reachable from `useCurrentEditor`, which the package's
    headless inspector and menus read. */
export function EmailEngineProvider({
  editor,
  children,
}: {
  editor: Editor
  children: React.ReactNode
}) {
  const value = React.useMemo(() => ({ editor }), [editor])
  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  )
}
