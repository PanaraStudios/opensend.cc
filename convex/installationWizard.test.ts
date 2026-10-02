import { beforeEach, expect, test, vi } from "vitest"
import {
  createElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { InstallationWizard } from "../components/onboarding/wizard"
import {
  EmailConfiguration,
  InstanceChannelConfiguration,
} from "../components/ses/email-configuration"

const state = vi.hoisted(() => ({
  installation: {
    _id: "installation",
    setupStep: "aws",
    emailDeferredAt: undefined as number | undefined,
    channels: undefined as { email?: boolean; meta?: boolean } | undefined,
  },
  admin: true,
  emailConfigured: false,
  metaConfigured: false,
  team: false,
  submit: undefined as ((form?: FormData) => Promise<unknown>) | undefined,
  defer: vi.fn(async () => undefined),
  choose: vi.fn(async () => undefined),
  deferMeta: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  replace: vi.fn(),
}))
vi.mock("convex/react", () => ({
  useQuery: (ref: string) =>
    ref === "status"
      ? {
          admin: state.admin,
          emailConfigured: state.emailConfigured,
          channels: {
            email: state.emailConfigured,
            meta: state.metaConfigured,
          },
          installation: state.installation,
          regions: [],
        }
      : undefined,
  useMutation: (ref: string) =>
    ref === "defer"
      ? state.defer
      : ref === "choose"
        ? state.choose
        : ref === "deferMeta"
          ? state.deferMeta
          : state.complete,
  useAction: () => vi.fn(),
}))
vi.mock("@/components/dashboard/settings-meta", () => ({
  SettingsMeta: () => createElement("span", null, "Shared Meta settings"),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    installation: {
      status: "status",
      deferEmail: "defer",
      chooseChannels: "choose",
      deferMeta: "deferMeta",
      complete: "complete",
    },
    meta: { app: {} },
    installationActions: {},
    domains: {},
    tenants: {},
  },
}))
vi.mock("@/components/auth/workspace", () => ({
  useWorkspace: () => ({
    teams: state.team ? [{ id: "team", name: "CRM" }] : [],
    activeTeamId: "team",
  }),
  CreateTeamForm: () => createElement("span", null, "Create team"),
  TeamAccess: () => null,
}))
vi.mock("@/components/auth/ui", () => ({
  AsyncForm: ({
    submitLabel,
    onSubmit,
    children,
  }: {
    submitLabel: string
    onSubmit: (form?: FormData) => Promise<unknown>
    children?: ReactNode
  }) => {
    state.submit = onSubmit
    return createElement(
      "form",
      null,
      children,
      createElement("button", null, submitLabel)
    )
  },
}))
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    name,
    defaultChecked,
  }: {
    name: string
    defaultChecked: boolean
  }) => createElement("input", { name, type: "checkbox", defaultChecked }),
}))
vi.mock("@/components/ui/field", () =>
  Object.fromEntries(
    [
      "Field",
      "FieldContent",
      "FieldDescription",
      "FieldGroup",
      "FieldLabel",
      "FieldSet",
      "FieldLegend",
      "FieldTitle",
    ].map((name) => [
      name,
      ({ children }: { children: ReactNode }) =>
        createElement("div", null, children),
    ])
  )
)
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    render,
  }: {
    children: ReactNode
    render?: ReactElement<{ children?: ReactNode }>
  }) =>
    render
      ? cloneElement(render, undefined, children)
      : createElement("button", null, children),
}))
vi.mock("@/components/ui/badge", () => ({ Badge: () => null }))
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => null }))
vi.mock("@/components/ui/progress", () => ({ Progress: () => null }))
vi.mock("@/components/ui/item", () => ({
  Item: () => null,
  ItemContent: () => null,
  ItemTitle: () => null,
  ItemDescription: () => null,
  ItemMedia: () => null,
  ItemGroup: () => null,
}))
vi.mock("@/components/dashboard/domains/list", () => ({
  AddDomainDialog: () => null,
}))
vi.mock("../components/onboarding/team-ses-status", () => ({
  TeamSesStatus: () => null,
}))
vi.mock("@/components/ses/connection-form", () => ({
  AwsConnectionForm: () => createElement("span", null, "AWS connection form"),
}))
vi.mock("@/components/dashboard/primitives", () => ({
  SetupDetails: () => null,
  EmptyState: ({
    title,
    description,
    children,
  }: {
    title: string
    description: string
    children: ReactNode
  }) => createElement("section", null, title, description, children),
}))
vi.mock("@/components/ses/delivery-form", () => ({
  DeliveryUrlForm: () => createElement("span", null, "Callback form"),
}))
vi.mock("@/components/ses/regions", () => ({ SesRegions: () => null }))
vi.mock(
  "@/lib/dashboard/use-instance-channels",
  async () => await import("../lib/dashboard/use-instance-channels")
)
vi.mock("@/lib/action-error", async () => await import("../lib/action-error"))
vi.mock(
  "@/lib/dashboard/installation-setup",
  async () => await import("../lib/dashboard/installation-setup")
)
vi.mock("@/convex/ses/contracts", () => ({ resourcePrefix: () => "test" }))

beforeEach(() => {
  vi.clearAllMocks()
  state.installation.setupStep = "aws"
  state.installation.emailDeferredAt = undefined
  state.installation.channels = undefined
  state.metaConfigured = false
  state.admin = true
  state.emailConfigured = false
  state.team = false
  state.submit = undefined
})

test("the wizard's secondary choice records deferral and the callback remains in the flow", async () => {
  const aws = renderToStaticMarkup(createElement(InstallationWizard))
  expect(aws).toContain("AWS connection form")
  expect(aws).toContain("Set up email later")
  await state.submit!()
  expect(state.defer).toHaveBeenCalledWith({})
  state.installation.emailDeferredAt = 1
  state.installation.setupStep = "callback"
  const callback = renderToStaticMarkup(createElement(InstallationWizard))
  expect(callback).toContain("Public callback URL")
  expect(callback).toContain("Callback form")
  expect(callback).toContain("of 4")
})

test("the deferred team step completes setup and opens Channels without a domain", async () => {
  state.installation.emailDeferredAt = 1
  state.installation.setupStep = "team"
  state.team = true
  const team = renderToStaticMarkup(createElement(InstallationWizard))
  expect(team).toContain("Finish setup")
  expect(team).not.toContain("Add first domain")
  await state.submit!()
  expect(state.complete).toHaveBeenCalledWith({ organizationId: "team" })
  expect(state.replace).toHaveBeenCalledWith("/channels")
})

test("email-only states show admin guidance; other channels and configured email pass through", () => {
  const content = createElement("span", null, "Messaging content")
  const screen = (required = true) =>
    renderToStaticMarkup(
      createElement(EmailConfiguration, { required }, content)
    )
  expect(screen()).toContain("Connect Amazon SES to send email")
  expect(screen()).toContain("/instance/ses")
  state.admin = false
  expect(screen()).toContain("Ask your instance admin")
  expect(screen()).not.toContain("/instance/ses")
  expect(screen(false)).toBe("<span>Messaging content</span>")
  state.emailConfigured = true
  expect(screen()).toBe("<span>Messaging content</span>")
})

test("the channel choice submits both options and reuses the Meta settings inside the wizard", async () => {
  state.installation.setupStep = "channels"
  const choices = renderToStaticMarkup(createElement(InstallationWizard))
  expect(choices).toContain("WhatsApp, Messenger &amp; Instagram")
  expect(choices).toContain("Choose at least one")
  const form = new FormData()
  form.set("meta", "on")
  await state.submit!(form)
  expect(state.choose).toHaveBeenCalledWith({ email: false, meta: true })
  state.installation.channels = { email: false, meta: true }
  state.installation.setupStep = "meta"
  const meta = renderToStaticMarkup(createElement(InstallationWizard))
  expect(meta).toContain("Shared Meta settings")
  expect(meta).toContain("Set up later")
  await state.submit!()
  expect(state.deferMeta).toHaveBeenCalledWith({})
})
test("the final step shows links for both providers, and Meta has member guidance too", () => {
  state.installation.channels = { email: false, meta: true }
  state.installation.setupStep = "team"
  state.team = true
  const team = renderToStaticMarkup(createElement(InstallationWizard))
  expect(team).toContain("/instance/ses")
  expect(team).toContain("/instance/meta")
  expect(team).toContain("set up later")
})

test("Meta uses the shared unavailable state for admins and members, then passes through when configured", () => {
  const content = createElement("span", null, "Meta content")
  const screen = () =>
    renderToStaticMarkup(
      createElement(InstanceChannelConfiguration, { channel: "meta" }, content)
    )
  expect(screen()).toContain("Meta isn&#x27;t set up on this instance")
  expect(screen()).toContain("/instance/meta")
  state.admin = false
  expect(screen()).toContain("Ask your instance admin")
  expect(screen()).not.toContain("/instance/meta")
  state.metaConfigured = true
  expect(screen()).toBe("<span>Meta content</span>")
})
