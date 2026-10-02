"use client"
import { useEffect, useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import {
  WorkflowIcon,
  PhoneIcon,
  ClockIcon,
  CornerDownRightIcon,
} from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  DetailHeader,
  DetailSection,
  EmptyState,
  ResourceTable,
  Th,
  RelativeTime,
  ToneBadge,
  TypeToConfirmDialog,
  MoreMenu,
} from "@/components/dashboard/primitives"
import { WorkflowCard } from "@/components/dashboard/automations/workflow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
import {
  VOICE_LANGUAGE_ITEMS,
  promptStatusBadge,
} from "@/lib/dashboard/voice-options"
import { uniqueSlug } from "@/lib/dashboard/slug"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import {
  newIvr,
  newIvrMenu,
  ivrFormPayload,
  ivrFormPatch,
  ivrActionLabel,
  renameIvrMenu,
} from "@/lib/dashboard/voice-playground"
import type { IvrDefinition, IvrAction, IvrMenu } from "@/lib/ivr"
import {
  VoiceChoiceField,
  VoiceField,
  MenuFields,
  BusinessHoursFields,
  ActionField,
  PromptRendersContext,
  type PromptRenderInfo,
} from "./ivr-fields"
import { IvrPromptVoiceFields } from "./prompt-voice"
import { VoiceRouting } from "./routing"
import { VoiceTester } from "./tester"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AudioPlayer } from "@/components/ui/audio-player"
import { useIsMobile } from "@/hooks/use-mobile"

type IvrResource = IvrDefinition & {
  prompt_renders?: PromptRenderInfo[]
  id: string
  prompt_status: string
  updated_at: string
}
type Selection = { menu: string; branch?: string } | { settings: true }
export function IvrList() {
  const [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([]),
    [creating, setCreating] = useState(false),
    [search, setSearch] = useState("")
  const list = useTeamQuery(api.ivr.definitions.dashboardList, {
      limit: 25,
      after,
    }),
    setup = useTeamQuery(api.calling.playgroundState.setup)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<Button onClick={() => setCreating(true)}>Create IVR</Button>}
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No IVRs"
          description="Help callers reach the right place with a simple phone menu."
        >
          <Button onClick={() => setCreating(true)}>Create IVR</Button>
        </EmptyState>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="ivr-search">Search IVRs</FieldLabel>
            <Input
              id="ivr-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
            />
          </Field>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Menus</Th>
                <Th className="hidden md:table-cell">Phone numbers</Th>
                <Th>Prompts</Th>
                <Th className="hidden md:table-cell">Updated</Th>
              </>
            }
          >
            {list.data
              .filter((ivr) =>
                ivr.name.toLowerCase().includes(search.toLowerCase())
              )
              .map((ivr: IvrResource) => (
                <TableRow key={ivr.id}>
                  <TableCell className="max-w-40 break-words whitespace-normal">
                    <Link
                      className="font-medium hover:underline"
                      href={`/playground/ivr/${ivr.id}`}
                    >
                      {ivr.name}
                    </Link>
                  </TableCell>
                  <TableCell>{ivr.menus.length}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {setup?.numbers
                        .filter((n) => n.routing === `ivr:${ivr.id}`)
                        .map((n) => (
                          <Badge key={n.id} variant="secondary">
                            {n.label}
                          </Badge>
                        ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ToneBadge
                      {...promptStatusBadge(
                        ivr.prompt_status,
                        !!ivr.promptVoice
                      )}
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <RelativeTime at={Date.parse(ivr.updated_at)} />
                  </TableCell>
                </TableRow>
              ))}
          </ResourceTable>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={!history.length}
              onClick={() => {
                setAfter(history.at(-1))
                setHistory(history.slice(0, -1))
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!list.has_more}
              onClick={() => {
                setHistory([...history, after])
                setAfter(list.data.at(-1)?.id)
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <CreateIvr close={() => setCreating(false)} /> : null}
      </Dialog>
    </SectionChrome>
  )
}
function CreateIvr({ close }: { close: () => void }) {
  const [draft, setDraft] = useState(newIvr),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const write = useAction(api.ivr.definitions.dashboardWrite),
    { activeTeamId } = useWorkspace(),
    router = useRouter()
  return (
    <DialogContent>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError("")
          try {
            const initial = {
              ...draft,
              menus: [
                {
                  ...draft.menus[0],
                  prompt: {
                    kind: "tts" as const,
                    text: "Welcome. How can we help you today?",
                  },
                },
              ],
            }
            const result = await write({
              organizationId: activeTeamId!,
              kind: "create",
              body: JSON.stringify(ivrFormPayload(initial)),
            })
            close()
            router.push(`/playground/ivr/${result.id}`)
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Create IVR</DialogTitle>
          <DialogDescription>
            Start with one menu, then add your call options.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-5">
          <VoiceField
            label="Name"
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <VoiceChoiceField
            label="Language"
            value={draft.language}
            items={VOICE_LANGUAGE_ITEMS}
            onChange={(language) => setDraft({ ...draft, language })}
          />
          <IvrPromptVoiceFields
            value={draft.promptVoice}
            onChange={(promptVoice) => setDraft({ ...draft, promptVoice })}
          />
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !draft.name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
export function IvrEditor({ id }: { id?: string }) {
  const row = useTeamQuery(
    api.ivr.definitions.dashboardGet,
    { id: id ?? "" },
    { enabled: !!id }
  ) as IvrResource | undefined
  if (!id) return <IvrList />
  if (!row) return <Skeleton className="h-60 w-full" />
  return <IvrForm key={id} row={row} />
}
function IvrForm({ row }: { row: IvrResource }) {
  const router = useRouter(),
    { activeTeamId } = useWorkspace(),
    mobile = useIsMobile()
  const editorPanel = useRef<HTMLElement>(null)
  const initial = {
    name: row.name,
    language: row.language,
    entryMenuId: row.entryMenuId,
    menus: row.menus,
    businessHours: row.businessHours,
    promptVoice: row.promptVoice,
  }
  const [draft, setDraft] = useState<IvrDefinition>(initial),
    [saved, setSaved] = useState(JSON.stringify(initial)),
    [selection, setSelection] = useState<Selection>({ menu: row.entryMenuId }),
    [editing, setEditing] = useState(false),
    [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [problems, setProblems] = useState<string[] | null>(null),
    [deleting, setDeleting] = useState(false)
  useEffect(() => {
    editorPanel.current?.scrollTo({ top: 0 })
  }, [selection])
  const write = useAction(api.ivr.definitions.dashboardWrite),
    render = useAction(api.ivr.rendering.dashboardRender),
    validate = useAction(api.ivr.definitions.dashboardValidate)
  const bots = useTeamQuery(api.voice.resources.dashboardList, { limit: 100 })
  useEffect(() => {
    document.title = `${row.name} · opensend.cc`
  }, [row.name])
  const patch = (v: Partial<IvrDefinition>) => setDraft((d) => ({ ...d, ...v }))
  function select(next: Selection) {
    setSelection(next)
    setEditing(true)
  }
  const menu =
    "menu" in selection
      ? draft.menus.find((m) => m.id === selection.menu)
      : undefined
  function updateMenu(next: IvrMenu) {
    const old = draft.menus.find((m) => m.id === next.id)
    const changed = {
      ...draft,
      menus: draft.menus.map((m) => (m.id === next.id ? next : m)),
    }
    if (
      old &&
      old.name !== next.name &&
      !row.menus.some((m) => m.id === next.id)
    ) {
      const renamed = renameIvrMenu(changed, next.id, next.name)
      const updated = renamed.menus[draft.menus.indexOf(old)]
      setDraft(renamed)
      setSelection({ menu: updated.id })
    } else setDraft(changed)
  }
  function addOption(m: IvrMenu) {
    const digit = "1234567890*#".split("").find((d) => !m.options[d])
    if (digit) {
      updateMenu({
        ...m,
        options: { ...m.options, [digit]: { kind: "hangup" } },
      })
      select({ menu: m.id })
    }
  }
  async function save() {
    setBusy(true)
    setError("")
    try {
      await write({
        organizationId: activeTeamId!,
        kind: "update",
        id: row.id,
        body: JSON.stringify(ivrFormPatch(draft)),
      })
      setSaved(JSON.stringify(draft))
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  function branch(m: IvrMenu, key: string) {
    return key === "No input"
      ? m.noInputAction
      : key === "Invalid"
        ? m.failureAction
        : m.options[key]
  }
  function actionName(action: IvrAction) {
    if (action.kind === "submenu")
      return (
        draft.menus.find((m) => m.id === action.menuId)?.name ??
        "Choose submenu"
      )
    if (action.kind === "bot")
      return `Voice bot ${bots?.data.flatMap((b) => ("name" in b && b.id === action.botId ? [b.name] : []))[0] ?? ""}`
    return ivrActionLabel(action)
  }
  function drawMenu(m: IvrMenu, seen: string[]): React.ReactNode {
    const rendered = row.prompt_renders?.find((r) =>
      m.prompt.kind === "tts"
        ? r.text === m.prompt.text &&
          r.voice === (m.prompt.voice ?? draft.promptVoice?.voice ?? null)
        : r.fileId === m.prompt.fileId
    )
    return (
      <div key={m.id} className="flex min-w-0 flex-col gap-3">
        <div
          className={
            "menu" in selection && selection.menu === m.id && !selection.branch
              ? "rounded-xl ring-2 ring-ring"
              : ""
          }
        >
          <WorkflowCard
            icon={WorkflowIcon}
            title={m.name}
            summary={
              m.prompt.kind === "tts" ? `“${m.prompt.text}”` : "Audio prompt"
            }
            onSelect={() => select({ menu: m.id })}
          >
            <div className="flex items-center justify-between gap-2">
              <ToneBadge
                {...promptStatusBadge(
                  rendered?.status ?? "pending_render",
                  !!draft.promptVoice
                )}
              />
              <Button size="sm" variant="ghost" onClick={() => addOption(m)}>
                + Add option
              </Button>
            </div>
            {rendered?.audio_url ? (
              <AudioPlayer
                src={rendered.audio_url}
                label={`${m.name} prompt`}
              />
            ) : null}
          </WorkflowCard>
        </div>
        <div className="ml-4 flex min-w-0 flex-col gap-4 border-l border-border-strong pl-4">
          {[
            ...Object.entries(m.options),
            ["No input", m.noInputAction],
            ["Invalid", m.failureAction],
          ].map(([key, action]) => {
            const a = action as IvrAction
            return (
              <div key={key as string} className="flex min-w-0 flex-col gap-2">
                <Badge variant="secondary" className="w-fit">
                  {key as string}
                </Badge>
                {a.kind === "submenu" &&
                !seen.includes(a.menuId) &&
                draft.menus.some((n) => n.id === a.menuId) ? (
                  drawMenu(
                    draft.menus.find((n) => n.id === a.menuId)!,
                    [...seen, a.menuId]
                  )
                ) : (
                  <div
                    className={
                      "menu" in selection &&
                      selection.menu === m.id &&
                      selection.branch === key
                        ? "rounded-xl ring-2 ring-ring"
                        : ""
                    }
                  >
                    <WorkflowCard
                      icon={CornerDownRightIcon}
                      title={actionName(a)}
                      onSelect={() =>
                        select({ menu: m.id, branch: key as string })
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  const editor = (
    <div className="flex min-w-0 flex-col gap-5 p-5">
      {"settings" in selection ? (
        <>
          <DetailSection title="IVR settings">
            <VoiceField
              label="Name"
              value={draft.name}
              onChange={(name) => patch({ name })}
            />
            <VoiceChoiceField
              label="Language"
              value={draft.language}
              items={VOICE_LANGUAGE_ITEMS}
              onChange={(language) => patch({ language })}
            />
            <VoiceChoiceField
              label="Entry menu"
              value={draft.entryMenuId}
              items={draft.menus.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(entryMenuId) => patch({ entryMenuId })}
            />
          </DetailSection>
          <IvrPromptVoiceFields
            value={draft.promptVoice}
            onChange={(promptVoice) => patch({ promptVoice })}
          />
          <BusinessHoursFields
            menus={draft.menus}
            value={draft.businessHours}
            onChange={(businessHours) => patch({ businessHours })}
          />
          <DetailSection title="Phone numbers">
            <VoiceRouting kind="ivr" id={row.id} />
          </DetailSection>
        </>
      ) : menu ? (
        selection.branch ? (
          <DetailSection title={`${menu.name} · ${selection.branch}`}>
            <ActionField
              label="Destination action"
              menus={draft.menus}
              value={branch(menu, selection.branch)}
              onChange={(a) =>
                updateMenu({
                  ...menu,
                  ...(selection.branch === "No input"
                    ? { noInputAction: a }
                    : selection.branch === "Invalid"
                      ? { failureAction: a }
                      : {
                          options: { ...menu.options, [selection.branch!]: a },
                        }),
                })
              }
            />
          </DetailSection>
        ) : (
          <>
            <h2 className="text-base font-medium">{menu.name}</h2>
            <MenuFields menu={menu} menus={draft.menus} onChange={updateMenu} />
            <Button
              variant="ghost"
              disabled={draft.menus.length === 1}
              onClick={() => {
                patch({ menus: draft.menus.filter((m) => m.id !== menu.id) })
                select({ settings: true })
              }}
            >
              Remove menu
            </Button>
          </>
        )
      ) : null}
    </div>
  )
  const referenced = new Set(
    draft.menus.flatMap((m) =>
      [...Object.values(m.options), m.noInputAction, m.failureAction].flatMap(
        (a) => (a.kind === "submenu" ? [a.menuId] : [])
      )
    )
  )
  return (
    <PromptRendersContext.Provider
      value={{
        renders:
          JSON.stringify(row.promptVoice) === JSON.stringify(draft.promptVoice)
            ? (row.prompt_renders ?? [])
            : [],
        voice: draft.promptVoice?.voice,
        provider: draft.promptVoice?.provider,
        credentialId: draft.promptVoice?.credentialId,
      }}
    >
      <div className="flex min-w-0 flex-col gap-5">
        <DetailHeader
          backHref="/playground/ivr"
          backLabel="IVR"
          title={row.name}
          icon={WorkflowIcon}
          badge={
            <ToneBadge
              {...promptStatusBadge(row.prompt_status, !!row.promptVoice)}
            />
          }
          actions={
            <>
              {JSON.stringify(draft) !== saved ? (
                <span className="text-xs text-muted-foreground">
                  Changes not saved
                </span>
              ) : null}
              <Button
                variant="outline"
                onClick={() => select({ settings: true })}
              >
                Settings
              </Button>
              <Button variant="outline" onClick={() => setTesting(true)}>
                Test IVR
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = await validate({
                      organizationId: activeTeamId!,
                      id: row.id,
                      body: JSON.stringify(ivrFormPatch(draft)),
                    })
                    setProblems(result.errors)
                  } catch (e) {
                    setError(actionError(e))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Validate
              </Button>
              <Button disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <MoreMenu>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        const result = await write({
                          organizationId: activeTeamId!,
                          kind: "create",
                          body: JSON.stringify(
                            ivrFormPayload({
                              ...draft,
                              name: `${draft.name} copy`,
                            })
                          ),
                        })
                        router.push(`/playground/ivr/${result.id}`)
                      } catch (e) {
                        setError(actionError(e))
                      }
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void navigator.clipboard.writeText(row.id)}
                  >
                    Copy ID
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        await render({
                          organizationId: activeTeamId!,
                          id: row.id,
                        })
                      } catch (e) {
                        setError(actionError(e))
                      }
                    }}
                  >
                    Generate prompts
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDeleting(true)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </MoreMenu>
            </>
          }
        />
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {problems ? (
          <Alert
            role="status"
            variant={problems.length ? "warning" : "success"}
          >
            <AlertTitle>
              {problems.length ? "Review the call flow" : "IVR is valid"}
            </AlertTitle>
            <AlertDescription>
              {problems.length ? (
                <ul>
                  {problems.map((problem, i) => (
                    <li key={i}>
                      <Button
                        variant="link"
                        className="h-auto text-left whitespace-normal"
                        onClick={() => {
                          const m = draft.menus.find((m) =>
                            problem.includes(m.id)
                          )
                          select(m ? { menu: m.id } : { settings: true })
                        }}
                      >
                        {problem.replace(
                          /menus\.(\d+)/g,
                          (_s, n) => draft.menus[Number(n)]?.name ?? "Menu"
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                "Every menu has a valid destination."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid min-w-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1fr)_380px]">
          <main
            aria-label="Call flow"
            className="flex min-w-0 flex-col items-center gap-0 overflow-y-auto bg-muted/30 p-5 lg:max-h-[78vh]"
          >
            <WorkflowCard
              icon={PhoneIcon}
              title="Incoming call"
              onSelect={() => select({ settings: true })}
            />
            <span aria-hidden className="h-6 w-px shrink-0 bg-border-strong" />
            {draft.businessHours ? (
              <>
                <WorkflowCard
                  icon={ClockIcon}
                  title="Business hours"
                  onSelect={() => select({ settings: true })}
                />
                <div className="flex w-full flex-col items-center gap-3 py-3">
                  <Badge variant="secondary">Closed</Badge>
                  <WorkflowCard
                    icon={CornerDownRightIcon}
                    title={actionName(draft.businessHours.closedAction)}
                    onSelect={() => select({ settings: true })}
                  />
                  <Badge variant="secondary">Open</Badge>
                </div>
              </>
            ) : null}
            <div className="w-full max-w-96">
              {draft.menus.find((m) => m.id === draft.entryMenuId)
                ? drawMenu(
                    draft.menus.find((m) => m.id === draft.entryMenuId)!,
                    [draft.entryMenuId]
                  )
                : null}
              {draft.menus
                .filter(
                  (m) => m.id !== draft.entryMenuId && !referenced.has(m.id)
                )
                .map((m) => (
                  <div key={m.id} className="mt-6">
                    {drawMenu(m, [m.id])}
                  </div>
                ))}
            </div>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => {
                const m = newIvrMenu(
                  uniqueSlug(
                    "New menu",
                    draft.menus.map((m) => m.id),
                    "menu"
                  )
                )
                patch({ menus: [...draft.menus, m] })
                select({ menu: m.id })
              }}
            >
              Add menu
            </Button>
          </main>
          {!mobile ? (
            <aside
              ref={editorPanel}
              aria-label="Flow editor"
              className="max-h-[78vh] min-w-0 overflow-y-auto border-l border-border"
            >
              {editor}
            </aside>
          ) : null}
        </div>
        <Sheet open={mobile && editing} onOpenChange={setEditing}>
          <SheetContent className="overflow-y-auto data-[side=right]:w-full">
            <SheetHeader>
              <SheetTitle>Edit call flow</SheetTitle>
            </SheetHeader>
            {mobile ? editor : null}
          </SheetContent>
        </Sheet>
        <Sheet open={testing} onOpenChange={setTesting}>
          <SheetContent className="overflow-y-auto data-[side=right]:w-full">
            <SheetHeader>
              <SheetTitle>Test IVR</SheetTitle>
            </SheetHeader>
            <VoiceTester
              kind="ivr"
              id={row.id}
              name={row.name}
              menus={draft.menus}
            />
          </SheetContent>
        </Sheet>
        <TypeToConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete IVR"
          description="Remove phone routing before deleting this IVR."
          phrase={row.name}
          confirmLabel="Delete IVR"
          onConfirm={async () => {
            await write({
              organizationId: activeTeamId!,
              kind: "remove",
              id: row.id,
              body: "{}",
            })
            router.push("/playground/ivr")
          }}
        />
      </div>
    </PromptRendersContext.Provider>
  )
}
