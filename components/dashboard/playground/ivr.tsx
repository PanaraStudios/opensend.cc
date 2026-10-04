"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import { WorkflowIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  DetailHeader,
  DetailSection,
  EmptyState,
  NotFoundState,
  ResourceTable,
  Th,
  RelativeTime,
  ToneBadge,
  TypeToConfirmDialog,
  MoreMenu,
} from "@/components/dashboard/primitives"
import {
  FlowEditor,
  FlowAdd,
  FlowNodeEditor,
  useFlowSelection,
} from "@/components/dashboard/flows/editor"
import { FlowPanel } from "@/components/dashboard/flows/panel"
import { ivrCatalog, newIvrAction, type IvrFlowContext } from "./ivr-catalog"
import {
  ivrGraph,
  ivrMenuKey,
  ivrActionKey,
  ivrEditableNodes,
  ivrProblemNodes,
  ivrProblemLabel,
  ivrMenuReferences,
  removeIvrMenu,
  setIvrBranch,
  nextIvrDigit,
  type IvrBranchAddress,
} from "./ivr-graph"
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
} from "@/lib/dashboard/voice-playground"
import type { IvrDefinition, IvrMenu } from "@/lib/ivr"
import {
  VoiceChoiceField,
  VoiceField,
  BusinessHoursFields,
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
const SETTINGS_KEY = "ivr-settings"
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
  ) as IvrResource | null | undefined
  if (!id) return <IvrList />
  if (row === null)
    return (
      <NotFoundState
        icon={WorkflowIcon}
        noun="IVR"
        backHref="/playground/ivr"
      />
    )
  if (!row) return <Skeleton className="h-60 w-full" />
  return <IvrForm key={id} row={row} />
}
function IvrForm({ row }: { row: IvrResource }) {
  const router = useRouter(),
    { activeTeamId } = useWorkspace(),
    mobile = useIsMobile()
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
    [editing, setEditing] = useState(false),
    [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [problems, setProblems] = useState<string[] | null>(null),
    [deleting, setDeleting] = useState(false)
  const { selected, setSelected } = useFlowSelection(
    ivrMenuKey(row.entryMenuId)
  )
  const [removingMenu, setRemovingMenu] = useState<IvrMenu | null>(null)
  const write = useAction(api.ivr.definitions.dashboardWrite),
    render = useAction(api.ivr.rendering.dashboardRender),
    validate = useAction(api.ivr.definitions.dashboardValidate)
  const bots = useTeamQuery(api.voice.resources.dashboardList, { limit: 100 })
  useEffect(() => {
    document.title = `${row.name} · opensend.cc`
  }, [row.name])
  const patch = (v: Partial<IvrDefinition>) => {
    setDraft((d) => ({ ...d, ...v }))
    setProblems(null)
    setError("")
  }
  function select(key: string) {
    setSelected(key)
    setEditing(true)
  }
  function updateMenu(next: IvrMenu) {
    patch({
      menus: draft.menus.map((menu) => (menu.id === next.id ? next : menu)),
    })
  }
  function createMenu(address: IvrBranchAddress) {
    if (draft.menus.length >= 50) return
    const parent = draft.menus.find((menu) => menu.id === address.menuId)
    if (!parent) return
    const menu = newIvrMenu(
      uniqueSlug(
        "New menu",
        draft.menus.map((m) => m.id),
        "menu"
      )
    )
    patch({
      menus: [
        ...draft.menus.map((m) =>
          m.id === parent.id
            ? setIvrBranch(m, address.branch, {
                kind: "submenu",
                menuId: menu.id,
              })
            : m
        ),
        menu,
      ],
    })
    select(ivrMenuKey(menu.id))
  }
  const graph = ivrGraph(draft)
  const problemNodes = ivrProblemNodes(draft, problems ?? [], graph.unreachable)
  const selectedNode = [...graph.nodes, ...ivrEditableNodes(draft)].find(
    (node) => node.key === selected
  )
  const context: IvrFlowContext = {
    definition: draft,
    bots: (bots?.data ?? []).flatMap((bot) =>
      "name" in bot ? [{ id: bot.id, name: bot.name }] : []
    ),
    updateMenu,
    select,
    createMenu,
    removeMenu: (menu) => {
      if (ivrMenuReferences(draft, menu.id).length) setRemovingMenu(menu)
      else {
        setDraft(removeIvrMenu(draft, menu.id))
        setProblems(null)
        select(ivrMenuKey(draft.entryMenuId))
      }
    },
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
      const message = actionError(e)
      setError(message)
      setProblems([message])
    } finally {
      setBusy(false)
    }
  }
  const editor = (
    <div className="flex min-w-0 flex-col gap-5 p-5">
      {selected === SETTINGS_KEY ? (
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
      ) : selectedNode ? (
        <FlowNodeEditor
          catalog={ivrCatalog}
          node={selectedNode}
          context={context}
          problems={(problemNodes.get(selectedNode.key) ?? []).map((problem) =>
            ivrProblemLabel(draft, problem)
          )}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a menu or destination to edit it.
        </p>
      )}
    </div>
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
              <Button variant="outline" onClick={() => select(SETTINGS_KEY)}>
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
                  setError("")
                  try {
                    const result = await validate({
                      organizationId: activeTeamId!,
                      id: row.id,
                      body: JSON.stringify({
                        ...draft,
                        promptVoice: draft.promptVoice ?? null,
                        businessHours: draft.businessHours ?? null,
                      }),
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
                          const key = [...problemNodes].find(([, errors]) =>
                            errors.includes(problem)
                          )?.[0]
                          select(key ?? SETTINGS_KEY)
                        }}
                      >
                        {ivrProblemLabel(draft, problem)}
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
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
          <main aria-label="Call flow" className="flex min-w-0 flex-col gap-4">
            <div className="flex h-[78vh] min-h-96 min-w-0">
              <FlowEditor
                catalog={ivrCatalog}
                context={context}
                steps={graph.root ? [graph.root] : []}
                selected={
                  graph.nodes.some((node) => node.key === selected)
                    ? selected
                    : (graph.nodes.find(
                        (node) =>
                          node.address &&
                          ivrActionKey(node.address) === selected
                      )?.key ?? selected)
                }
                onSelect={select}
                stacked={mobile}
                problems={(node) =>
                  (problemNodes.get(node.key) ?? []).map((problem) =>
                    ivrProblemLabel(draft, problem)
                  )
                }
                nodeActions={(node) => (
                  <>
                    {node.address &&
                    (node.kind === "menu" || node.kind === "submenu") ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${node.menu.name} destination`}
                        onClick={() => select(ivrActionKey(node.address!))}
                      >
                        Edit path
                      </Button>
                    ) : null}
                    {node.kind === "menu" && nextIvrDigit(node.menu) ? (
                      <FlowAdd
                        catalog={ivrCatalog}
                        label={`Add option · Press ${nextIvrDigit(node.menu)}`}
                        groups={[
                          {
                            label: `Press ${nextIvrDigit(node.menu)}`,
                            types: ivrCatalog.entries.menu.addAfter(node),
                          },
                        ]}
                        disabled={(kind) =>
                          kind === "menu" && draft.menus.length >= 50
                        }
                        onAdd={(kind) => {
                          const digit = nextIvrDigit(node.menu)
                          if (!digit) return
                          const address = {
                            menuId: node.menu.id,
                            branch: digit,
                          }
                          if (kind === "menu") createMenu(address)
                          else {
                            updateMenu(
                              setIvrBranch(
                                node.menu,
                                digit,
                                newIvrAction(kind, draft)
                              )
                            )
                            select(ivrActionKey(address))
                          }
                        }}
                      />
                    ) : null}
                  </>
                )}
                nodeBody={(node) => {
                  if (node.kind !== "menu") return null
                  const prompt = node.menu.prompt
                  const rendered =
                    JSON.stringify(row.promptVoice) ===
                    JSON.stringify(draft.promptVoice)
                      ? row.prompt_renders?.find((r) =>
                          prompt.kind === "tts"
                            ? r.text === prompt.text &&
                              r.voice ===
                                (prompt.voice ??
                                  draft.promptVoice?.voice ??
                                  null)
                            : r.fileId === prompt.fileId
                        )
                      : undefined
                  return (
                    <>
                      <ToneBadge
                        {...promptStatusBadge(
                          rendered?.status ?? "pending_render",
                          !!draft.promptVoice
                        )}
                      />
                      {rendered?.audio_url ? (
                        <AudioPlayer
                          src={rendered.audio_url}
                          label={`${node.menu.name} prompt`}
                        />
                      ) : null}
                    </>
                  )
                }}
              />
            </div>
            {graph.otherMenus.length ? (
              <Alert variant="warning">
                <AlertTitle>Menus outside the entry flow</AlertTitle>
                <AlertDescription>
                  Connect these menus from a digit option or business hours.
                  Select a menu to edit or remove it.
                  <div className="flex flex-wrap gap-2">
                    {graph.otherMenus.map((menu) => (
                      <Button
                        key={menu.id}
                        variant="link"
                        onClick={() => select(ivrMenuKey(menu.id))}
                      >
                        {menu.name}
                        {problemNodes.has(ivrMenuKey(menu.id))
                          ? " · Needs attention"
                          : ""}
                      </Button>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
          </main>
          <FlowPanel
            selection={selected}
            open={editing}
            onOpenChange={setEditing}
            title="Edit call flow"
          >
            {editor}
          </FlowPanel>
        </div>
        <TypeToConfirmDialog
          open={removingMenu !== null}
          onOpenChange={(open) => {
            if (!open) setRemovingMenu(null)
          }}
          title="Remove menu"
          phrase={removingMenu?.name ?? ""}
          confirmLabel="Remove menu"
          description={
            removingMenu
              ? `Used by: ${ivrMenuReferences(draft, removingMenu.id).join(", ")}. These destinations will hang up. ${draft.entryMenuId === removingMenu.id ? "The first remaining menu will become the entry menu." : ""}`
              : ""
          }
          onConfirm={() => {
            if (!removingMenu) return
            const next = removeIvrMenu(draft, removingMenu.id)
            setDraft(next)
            setProblems(null)
            setRemovingMenu(null)
            select(ivrMenuKey(next.entryMenuId))
          }}
        />
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
