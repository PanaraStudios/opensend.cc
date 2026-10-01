"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import { WorkflowIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  DocsButton,
  DetailHeader,
  DetailSection,
  MetaStrip,
  EmptyState,
  ResourceTable,
  Th,
  RelativeTime,
  OptionSelect,
  TypeToConfirmDialog,
} from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { FieldError } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/toast"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import {
  newIvr,
  newIvrMenu,
  ivrFormPayload,
  ivrFormPatch,
} from "@/lib/dashboard/voice-playground"
import { validateIvr, type IvrDefinition } from "@/lib/ivr"
import { VoiceField, MenuFields, BusinessHoursFields } from "./ivr-fields"
import { PromptRendersContext, type PromptRenderInfo } from "./ivr-fields"
import { IvrPromptVoiceFields } from "./prompt-voice"
import { VoiceRouting } from "./routing"
import { VoiceTester } from "./tester"

export function IvrList() {
  const [after, setAfter] = useState<string>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const list = useTeamQuery(api.ivr.definitions.dashboardList, {
    limit: 25,
    after,
  })
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={
        <>
          <Button
            nativeButton={false}
            render={<Link href="/playground/ivr/new" />}
          >
            Create IVR
          </Button>
          <DocsButton href="https://github.com/PanaraStudios/opensend.cc/blob/v2/docs/ivr.md" />
        </>
      }
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No IVRs"
          description="Build a menu tree, assign a number and test it from your browser."
        >
          <Button
            nativeButton={false}
            render={<Link href="/playground/ivr/new" />}
          >
            Create IVR
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Menus</Th>
                <Th>Assigned numbers</Th>
                <Th>Prompts</Th>
                <Th>Updated</Th>
              </>
            }
          >
            {list.data.map((ivr: IvrResource) => (
              <TableRow key={ivr.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/playground/ivr/${ivr.id}`}
                  >
                    {ivr.name}
                  </Link>
                </TableCell>
                <TableCell>{ivr.menus.length}</TableCell>
                <TableCell>
                  {setup?.numbers
                    .filter((n) => n.routing === `ivr:${ivr.id}`)
                    .map((n) => n.label)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ivr.prompt_status}</Badge>
                </TableCell>
                <TableCell>
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
    </SectionChrome>
  )
}
type IvrResource = IvrDefinition & {
  prompt_renders?: PromptRenderInfo[]
  id: string
  prompt_status: string
  updated_at: string
}
export function IvrEditor({ id }: { id?: string }) {
  const row: IvrResource | undefined = useTeamQuery(
    api.ivr.definitions.dashboardGet,
    { id: id ?? "" },
    { enabled: !!id }
  )
  if (id && !row) return <Skeleton className="h-60 w-full" />
  return <IvrForm key={id ?? "new"} row={row} />
}
function IvrForm({ row }: { row?: IvrResource }) {
  const router = useRouter()
  const { activeTeamId } = useWorkspace()
  const [draft, setDraft] = useState<IvrDefinition>(() =>
    row
      ? {
          name: row.name,
          language: row.language,
          entryMenuId: row.entryMenuId,
          menus: row.menus,
          businessHours: row.businessHours,
          promptVoice: row.promptVoice,
        }
      : newIvr()
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const write = useAction(api.ivr.definitions.dashboardWrite)
  const render = useAction(api.ivr.rendering.dashboardRender)
  const validate = useAction(api.ivr.definitions.dashboardValidate)
  const patch = (v: Partial<IvrDefinition>) => setDraft({ ...draft, ...v })
  async function save() {
    setBusy(true)
    setError("")
    try {
      const result = await write({
        organizationId: activeTeamId!,
        kind: row ? "update" : "create",
        id: row?.id,
        body: JSON.stringify(row ? ivrFormPatch(draft) : ivrFormPayload(draft)),
      })
      toast.add({ type: "success", title: "IVR saved" })
      if (!row) router.push(`/playground/ivr/${result.id}`)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  async function check() {
    setBusy(true)
    setError("")
    try {
      const result = row
        ? await validate({
            organizationId: activeTeamId!,
            id: row.id,
            body: JSON.stringify(ivrFormPatch(draft)),
          })
        : validateIvr(draft)
      if (!result.valid) setError(result.errors.join("; "))
      else toast.add({ type: "success", title: "IVR is valid" })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <PromptRendersContext.Provider
      value={{
        renders:
          JSON.stringify(row?.promptVoice) === JSON.stringify(draft.promptVoice)
            ? (row?.prompt_renders ?? [])
            : [],
        voice: draft.promptVoice?.voice,
      }}
    >
      <DetailHeader
        backHref="/playground/ivr"
        backLabel="IVR"
        title={row?.name ?? "Create IVR"}
        icon={WorkflowIcon}
        actions={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void check()}
            >
              Validate
            </Button>
            {row?.promptVoice ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError("")
                  try {
                    await render({ organizationId: activeTeamId!, id: row.id })
                  } catch (e) {
                    setError(actionError(e))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Render prompts
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Working…" : "Save"}
            </Button>
            {row ? (
              <Button variant="destructive" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      {row ? (
        <MetaStrip
          items={[
            { label: "Prompts", value: row.prompt_status },
            { label: "ID", value: row.id },
          ]}
        />
      ) : null}
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        <DetailSection title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <VoiceField
              label="Name"
              value={draft.name}
              onChange={(name) => patch({ name })}
            />
            <VoiceField
              label="Language"
              value={draft.language}
              onChange={(language) => patch({ language })}
            />
          </div>
          <OptionSelect
            aria-label="Entry menu"
            value={draft.entryMenuId}
            onChange={(entryMenuId) => patch({ entryMenuId })}
            items={draft.menus.map((m) => ({
              value: m.id,
              label: m.name || m.id,
            }))}
          />
        </DetailSection>
        <IvrPromptVoiceFields
          value={draft.promptVoice}
          onChange={(promptVoice) => patch({ promptVoice })}
        />
        {draft.menus.map((m, i) => (
          <DetailSection
            key={i}
            title={`Menu ${i + 1}: ${m.name}`}
            actions={
              <Button
                type="button"
                variant="ghost"
                disabled={draft.menus.length === 1}
                onClick={() =>
                  patch({ menus: draft.menus.filter((_, n) => n !== i) })
                }
              >
                Remove menu
              </Button>
            }
          >
            <MenuFields
              menu={m}
              menus={draft.menus}
              onChange={(next) =>
                patch({
                  menus: draft.menus.map((x, n) => (n === i ? next : x)),
                })
              }
            />
          </DetailSection>
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={draft.menus.length >= 50}
          onClick={() =>
            patch({
              menus: [
                ...draft.menus,
                newIvrMenu(`menu-${crypto.randomUUID().slice(0, 8)}`),
              ],
            })
          }
        >
          Add menu
        </Button>
        <BusinessHoursFields
          menus={draft.menus}
          value={draft.businessHours}
          onChange={(businessHours) => patch({ businessHours })}
        />
      </form>
      {row ? (
        <>
          <VoiceRouting kind="ivr" id={row.id} />
          <VoiceTester kind="ivr" id={row.id} />
        </>
      ) : null}
      {row ? (
        <TypeToConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete IVR"
          description="Remove number routing before deleting this IVR."
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
      ) : null}
    </PromptRendersContext.Provider>
  )
}
