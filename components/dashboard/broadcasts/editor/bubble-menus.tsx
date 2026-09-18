"use client"

import * as React from "react"
import {
  BubbleMenuRoot,
  bubbleMenuTriggers,
  useBubbleMenuContext,
  type TriggerFn,
} from "@react-email/editor/ui"
import {
  getSelectionAlignment,
  setTextAlignment,
} from "@react-email/editor/utils"
import { PluginKey } from "@tiptap/pm/state"
import { useEditorState, type Editor } from "@tiptap/react"
import {
  CheckIcon,
  ExternalLinkIcon,
  LinkIcon,
  PencilIcon,
  UnlinkIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import {
  ALIGN_ITEMS,
  FLOATING_SURFACE,
  TEXT_MARKS,
} from "@/components/dashboard/broadcasts/editor/controls"
import { normalizeHref } from "@/lib/dashboard/format"
import { cn } from "@/lib/utils"

/* Floating toolbars. The engine decides when each one shows and where it
   sits; the buttons inside are ours and call the editor directly. */

const SURFACE = cn("z-40 flex items-center gap-0.5", FLOATING_SURFACE)

const KEYS = {
  text: new PluginKey("opensendTextBubble"),
  link: new PluginKey("opensendLinkBubble"),
  button: new PluginKey("opensendButtonBubble"),
  image: new PluginKey("opensendImageBubble"),
}

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
  const [invalid, setInvalid] = React.useState(false)

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const next = normalizeHref(value)
        if (next === null) setInvalid(true)
        else onApply(next)
      }}
    >
      <Input
        autoFocus
        value={value}
        aria-invalid={invalid}
        className="h-control-sm w-60"
        placeholder="https://example.com"
        aria-label="URL"
        data-testid={testId}
        onChange={(event) => {
          setValue(event.target.value)
          setInvalid(false)
        }}
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
          {/* A stored destination may predate the check above, or come from
              pasted markup, so it is only offered to open when it is safe. */}
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            aria-label="Open link"
            disabled={normalizeHref(href) === null}
            render={
              <a
                href={normalizeHref(href) ?? undefined}
                target="_blank"
                rel="noreferrer"
              />
            }
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

/* The three things that carry a destination. They differ only in where the
   href lives and how it is written back. */
const URL_MENUS: {
  node: "link" | "button" | "image"
  trigger: TriggerFn
  apply: (editor: Editor, href: string) => void
}[] = [
  {
    node: "link",
    trigger: bubbleMenuTriggers.nodeWithoutSelection("link"),
    apply: (editor, href) => {
      const chain = editor.chain().focus().extendMarkRange("link")
      if (href) chain.setLink({ href }).run()
      else chain.unsetLink().run()
    },
  },
  {
    node: "button",
    trigger: bubbleMenuTriggers.node("button"),
    apply: (editor, href) =>
      editor.commands.updateButton({ href: href || "#" }),
  },
  {
    node: "image",
    trigger: bubbleMenuTriggers.node("image"),
    apply: (editor, href) =>
      editor.commands.updateAttributes("image", { href }),
  },
]

function NodeUrlToolbar({ menu }: { menu: (typeof URL_MENUS)[number] }) {
  const { editor } = useBubbleMenuContext()
  const href = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      shownHref(current.getAttributes(menu.node).href),
  })
  return (
    <UrlToolbar
      href={href}
      testId={`bubble-${menu.node}`}
      onApply={(next) => menu.apply(editor, next)}
    />
  )
}

function TextToolbar() {
  const { editor, isEditing, setIsEditing } = useBubbleMenuContext()
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      marks: TEXT_MARKS.filter((mark) => current.isActive(mark.name)).map(
        (mark) => mark.name
      ),
      alignment: getSelectionAlignment(current),
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
      {TEXT_MARKS.map(({ name, label, icon: Icon }) => (
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
      {ALIGN_ITEMS.map(({ value, label, icon: Icon }) => (
        <Toggle
          key={value}
          size="sm"
          aria-label={label}
          pressed={active.alignment === value}
          data-testid={`bubble-align-${value}`}
          onPressedChange={() => setTextAlignment(editor, value)}
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

export function BubbleMenus() {
  return (
    <>
      <BubbleMenuRoot
        pluginKey={KEYS.text}
        /* Shown over linked text too: the link toolbar is for a caret resting
           in a link, this one for a selection, so they never meet, and text
           that happens to be linked still has to be formatted and aligned. */
        trigger={bubbleMenuTriggers.textSelection([
          "button",
          "image",
          "horizontalRule",
          "codeBlock",
        ])}
        placement="top"
        className={SURFACE}
        data-testid="bubble-text"
      >
        <TextToolbar />
      </BubbleMenuRoot>
      {URL_MENUS.map((menu) => (
        <BubbleMenuRoot
          key={menu.node}
          pluginKey={KEYS[menu.node]}
          trigger={menu.trigger}
          /* These show for a caret merely resting in a link, so they sit
             below it: above, they cover the line the author is reading and
             take the click meant for it. */
          placement="bottom"
          className={SURFACE}
        >
          <NodeUrlToolbar menu={menu} />
        </BubbleMenuRoot>
      ))}
    </>
  )
}
