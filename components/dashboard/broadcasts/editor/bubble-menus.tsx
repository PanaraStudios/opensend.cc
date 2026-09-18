"use client"

import * as React from "react"
import {
  BubbleMenuRoot,
  bubbleMenuTriggers,
  useBubbleMenuContext,
} from "@react-email/editor/ui"
import { PluginKey } from "@tiptap/pm/state"
import { useEditorState, type Editor } from "@tiptap/react"
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CheckIcon,
  CodeIcon,
  ExternalLinkIcon,
  ItalicIcon,
  LinkIcon,
  PencilIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UnlinkIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"

/* Floating toolbars. The engine decides when each one shows and where it
   sits; the buttons inside are ours and call the editor directly. */

const SURFACE =
  "z-40 flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float"

const KEYS = {
  text: new PluginKey("opensendTextBubble"),
  link: new PluginKey("opensendLinkBubble"),
  button: new PluginKey("opensendButtonBubble"),
  image: new PluginKey("opensendImageBubble"),
}

type IconType = React.ComponentType<{ className?: string }>

const MARKS: { name: string; label: string; icon: IconType }[] = [
  { name: "bold", label: "Bold", icon: BoldIcon },
  { name: "italic", label: "Italic", icon: ItalicIcon },
  { name: "underline", label: "Underline", icon: UnderlineIcon },
  { name: "strike", label: "Strikethrough", icon: StrikethroughIcon },
  { name: "code", label: "Inline code", icon: CodeIcon },
]

const ALIGNMENTS: { value: string; label: string; icon: IconType }[] = [
  { value: "left", label: "Align left", icon: AlignLeftIcon },
  { value: "center", label: "Align center", icon: AlignCenterIcon },
  { value: "right", label: "Align right", icon: AlignRightIcon },
]

/* "#" is how the engine stores "no destination yet". */
function shownHref(href: unknown): string {
  return typeof href === "string" && href !== "#" ? href : ""
}

/** The toolbar's URL row: Enter or the tick applies, an empty value clears. */
function UrlForm({
  href,
  testId,
  onApply,
}: {
  href: string
  testId: string
  onApply: (href: string) => void
}) {
  const [value, setValue] = React.useState(href)

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(value.trim())
      }}
    >
      <Input
        autoFocus
        value={value}
        className="h-control-sm w-60"
        placeholder="https://example.com"
        aria-label="URL"
        data-testid={testId}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" size="icon-sm" aria-label="Apply URL">
        <CheckIcon />
      </Button>
    </form>
  )
}

/** Shows the destination with edit, open and remove; edit swaps in the form. */
function UrlToolbar({
  href,
  testId,
  onApply,
}: {
  href: string
  testId: string
  onApply: (href: string) => void
}) {
  const { isEditing, setIsEditing } = useBubbleMenuContext()

  if (isEditing) {
    return (
      <UrlForm
        href={href}
        testId={`${testId}-input`}
        onApply={(next) => {
          onApply(next)
          setIsEditing(false)
        }}
      />
    )
  }
  return (
    <>
      <span className="max-w-48 truncate px-1.5 text-sm text-muted-foreground">
        {href || "No link"}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit link"
        data-testid={`${testId}-edit`}
        onClick={() => setIsEditing(true)}
      >
        <PencilIcon />
      </Button>
      {href ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            aria-label="Open link"
            render={<a href={href} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove link"
            data-testid={`${testId}-remove`}
            onClick={() => onApply("")}
          >
            <UnlinkIcon />
          </Button>
        </>
      ) : null}
    </>
  )
}

function useAttr(editor: Editor, node: string, name: string): string {
  return useEditorState({
    editor,
    selector: ({ editor: current }) =>
      shownHref(current.getAttributes(node)[name]),
  })
}

function TextToolbar() {
  const { editor, isEditing, setIsEditing } = useBubbleMenuContext()
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      marks: MARKS.filter((mark) => current.isActive(mark.name)).map(
        (mark) => mark.name
      ),
      alignment: ALIGNMENTS.find((item) =>
        current.isActive({ alignment: item.value })
      )?.value,
    }),
  })

  if (isEditing) {
    return (
      <UrlForm
        href=""
        testId="bubble-text-link-input"
        onApply={(href) => {
          if (href) editor.chain().focus().setLink({ href }).run()
          setIsEditing(false)
        }}
      />
    )
  }
  return (
    <>
      {MARKS.map(({ name, label, icon: Icon }) => (
        <Toggle
          key={name}
          size="sm"
          aria-label={label}
          pressed={active.marks.includes(name)}
          data-testid={`bubble-${name}`}
          onPressedChange={() => editor.chain().focus().toggleMark(name).run()}
        >
          <Icon />
        </Toggle>
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {ALIGNMENTS.map(({ value, label, icon: Icon }) => (
        <Toggle
          key={value}
          size="sm"
          aria-label={label}
          pressed={active.alignment === value}
          data-testid={`bubble-align-${value}`}
          onPressedChange={() =>
            editor.chain().focus().setAlignment(value).run()
          }
        >
          <Icon />
        </Toggle>
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Add link"
        data-testid="bubble-link"
        onClick={() => setIsEditing(true)}
      >
        <LinkIcon />
      </Button>
    </>
  )
}

function LinkToolbar() {
  const { editor } = useBubbleMenuContext()
  const href = useAttr(editor, "link", "href")
  return (
    <UrlToolbar
      href={href}
      testId="bubble-link"
      onApply={(next) => {
        const chain = editor.chain().focus().extendMarkRange("link")
        if (next) chain.setLink({ href: next }).run()
        else chain.unsetLink().run()
      }}
    />
  )
}

function ButtonToolbar() {
  const { editor } = useBubbleMenuContext()
  const href = useAttr(editor, "button", "href")
  return (
    <UrlToolbar
      href={href}
      testId="bubble-button"
      onApply={(next) => editor.commands.updateButton({ href: next || "#" })}
    />
  )
}

function ImageToolbar() {
  const { editor } = useBubbleMenuContext()
  const href = useAttr(editor, "image", "href")
  return (
    <UrlToolbar
      href={href}
      testId="bubble-image"
      onApply={(next) =>
        editor.commands.updateAttributes("image", { href: next })
      }
    />
  )
}

export function BubbleMenus() {
  return (
    <>
      <BubbleMenuRoot
        pluginKey={KEYS.text}
        trigger={bubbleMenuTriggers.textSelection(
          ["button", "image", "horizontalRule", "codeBlock"],
          ["link"]
        )}
        placement="top"
        className={SURFACE}
        data-testid="bubble-text"
      >
        <TextToolbar />
      </BubbleMenuRoot>
      <BubbleMenuRoot
        pluginKey={KEYS.link}
        trigger={bubbleMenuTriggers.nodeWithoutSelection("link")}
        placement="top"
        className={SURFACE}
      >
        <LinkToolbar />
      </BubbleMenuRoot>
      <BubbleMenuRoot
        pluginKey={KEYS.button}
        trigger={bubbleMenuTriggers.node("button")}
        placement="top"
        className={SURFACE}
      >
        <ButtonToolbar />
      </BubbleMenuRoot>
      <BubbleMenuRoot
        pluginKey={KEYS.image}
        trigger={bubbleMenuTriggers.node("image")}
        placement="top"
        className={SURFACE}
      >
        <ImageToolbar />
      </BubbleMenuRoot>
    </>
  )
}
