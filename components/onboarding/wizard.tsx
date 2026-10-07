"use client"
import { TelemetrySettings } from "@/components/dashboard/settings-telemetry"
import * as React from "react"
import Link from "next/link"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldTitle,
} from "@/components/ui/field"
import { SettingsMeta } from "@/components/dashboard/settings-meta"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloudIcon,
  GlobeIcon,
  UsersIcon,
} from "lucide-react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import {
  useWorkspace,
  CreateTeamForm,
  TeamAccess,
} from "@/components/auth/workspace"
import { AsyncForm } from "@/components/auth/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemMedia,
  ItemGroup,
} from "@/components/ui/item"
import { AddDomainDialog } from "@/components/dashboard/domains/add-domain"
import { TeamSesStatus } from "./team-ses-status"
import { AwsConnectionForm } from "@/components/ses/connection-form"
import { SetupDetails } from "@/components/dashboard/primitives"
import { DeliveryUrlForm } from "@/components/ses/delivery-form"
import { SesRegions } from "@/components/ses/regions"
import { actionError } from "@/lib/action-error"
import { resourcePrefix } from "@/convex/ses/contracts"
import {
  setupSteps,
  nextSetupStep,
  emailSetupRequired,
  inferredSetupStep,
  type SetupStep as Step,
} from "@/lib/dashboard/installation-setup"
const copy: Record<
  Step,
  { label: string; title: string; description: string }
> = {
  welcome: {
    label: "Welcome",
    title: "Set up Opensend",
    description: "Connect messaging channels for your team. Email is optional.",
  },
  channels: {
    label: "Choose channels",
    title: "Choose channels",
    description:
      "Choose what this instance uses. You can add email or Meta channels later.",
  },
  meta: {
    label: "Meta app",
    title: "Set up your Meta app",
    description:
      "One app connects WhatsApp, Messenger and Instagram for every team.",
  },
  aws: {
    label: "AWS account",
    title: "Connect your AWS account",
    description: "Connect Amazon SES for email, or set it up later.",
  },
  callback: {
    label: "Public callback URL",
    title: "Public callback URL",
    description: "Receive email delivery updates and Meta webhooks.",
  },
  resources: {
    label: "Email delivery",
    title: "Set up your AWS resources",
    description: "Opensend will prepare email delivery in these regions.",
  },
  team: {
    label: "Your team",
    title: "Create your team",
    description: "Choose a name for your workspace.",
  },
  domain: {
    label: "Sending domain",
    title: "Add your sending domain",
    description: "This is the domain your emails will come from.",
  },
}
export function InstallationWizard() {
  const router = useRouter()
  const status = useQuery(api.installation.status)
  const workspace = useWorkspace()
  const initialize = useAction(api.installationActions.initialize)
  const navigate = useMutation(api.installation.navigate)
  const provision = useMutation(api.installation.provisionRegion)
  const complete = useMutation(api.installation.complete)
  const deferEmail = useMutation(api.installation.deferEmail)
  const deferMeta = useMutation(api.installation.deferMeta)
  const chooseChannels = useMutation(api.installation.chooseChannels)
  const [editingConnection, setEditingConnection] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [error, setError] = React.useState("")
  const [moving, setMoving] = React.useState(false)
  const heading = React.useRef<HTMLHeadingElement>(null)
  const installation = status?.installation
  const ready =
    !!status?.regions.length &&
    status.regions.every((region) => region.phase === "ready")
  const active = workspace.teams.find(
    (team) => team.id === workspace.activeTeamId
  )
  const needsEmail = emailSetupRequired(installation ?? {})
  const steps = setupSteps(installation ?? {})
  const inferred = inferredSetupStep(
    installation,
    ready,
    !!active,
    !!status?.channels.meta
  )
  const saved = installation?.setupStep
  const step =
    saved && (steps.includes(saved) || saved === "channels") ? saved : inferred
  const index = steps.indexOf(step)
  const domains = useQuery(
    api.domains.list,
    step === "domain" && active && !active.ssoRequired
      ? {
          organizationId: active.id,
          paginationOpts: { cursor: null, numItems: 1 },
        }
      : "skip"
  )
  const tenants = useQuery(
    api.tenants.list,
    active && !active.ssoRequired ? { organizationId: active.id } : "skip"
  )
  const tenantReady = tenants?.some(
    (tenant) =>
      tenant.region === (installation?.defaultRegion ?? "us-east-1") &&
      tenant.phase === "ready"
  )
  const completedAt = installation?.completedAt
  const firstDomainId = domains?.page[0]?._id
  const activeId = active?.id
  React.useEffect(() => {
    if (!completedAt && firstDomainId && activeId && tenantReady)
      void complete({ organizationId: activeId })
        .then(() => router.replace(`/domains/${firstDomainId}`))
        .catch((e) => setError(actionError(e)))
  }, [completedAt, firstDomainId, activeId, tenantReady, complete, router])
  React.useEffect(() => {
    heading.current?.focus()
  }, [step])
  if (!status) return <Skeleton className="h-40 w-full" />
  async function go(next: Step) {
    setMoving(true)
    setError("")
    setEditingConnection(false)
    try {
      await navigate({ step: next })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setMoving(false)
    }
  }
  const busy = status.regions.some((region) => region.phase === "running")
  const prefix = resourcePrefix(installation?._id ?? "")
  return (
    <div
      className="flex w-full flex-col gap-7"
      data-testid="installation-wizard"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{copy[step].label}</span>
          <span>
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <Progress
          value={(index / steps.length) * 100}
          aria-label="Setup progress"
        />
      </div>
      <header className="flex flex-col gap-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {copy[step].title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {copy[step].description}
        </p>
      </header>
      {/* The h1 above already names this step; a duplicate region name would
          also collide with field labels that share the step title. */}
      <section key={step} className="flex flex-col gap-5">
        {step === "welcome" && (
          <>
            <ItemGroup className="gap-2">
              {[
                {
                  Icon: CloudIcon,
                  title: "Connect AWS",
                  description:
                    "Optional: use your Amazon SES account for email.",
                },
                {
                  Icon: UsersIcon,
                  title: "Create a team",
                  description: "Keep your projects and sending separate.",
                },
                {
                  Icon: GlobeIcon,
                  title: "Connect channels",
                  description:
                    "Connect WhatsApp, Messenger or Instagram from your dashboard.",
                },
              ].map(({ Icon, title, description }) => (
                <Item key={title} size="sm">
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{title}</ItemTitle>
                    <ItemDescription>{description}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
            <AsyncForm
              fullWidth
              submitLabel="Get started"
              success={false}
              onSubmit={() => initialize()}
            />
          </>
        )}
        {step === "channels" && <TelemetrySettings setup />}
        {step === "channels" && (
          <AsyncForm
            fullWidth
            submitLabel="Continue"
            success={false}
            onSubmit={(form) =>
              chooseChannels({
                email: form.get("email") !== null,
                meta: form.get("meta") !== null,
              })
            }
          >
            <FieldSet>
              <FieldLegend>Messaging channels</FieldLegend>
              <FieldDescription>Choose at least one.</FieldDescription>
              <FieldGroup>
                {(
                  [
                    {
                      name: "email",
                      title: "Email",
                      description: "Amazon SES; send, receive, broadcasts.",
                    },
                    {
                      name: "meta",
                      title: "WhatsApp, Messenger & Instagram",
                      description: "One Meta app for this install.",
                    },
                  ] as const
                ).map((choice) => (
                  <FieldLabel key={choice.name}>
                    <Field orientation="horizontal">
                      <Checkbox
                        name={choice.name}
                        defaultChecked={!!installation?.channels?.[choice.name]}
                      />
                      <FieldContent>
                        <FieldTitle>{choice.title}</FieldTitle>
                        <FieldDescription>
                          {choice.description}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </FieldGroup>
            </FieldSet>
          </AsyncForm>
        )}
        {step === "meta" && (
          <>
            <SettingsMeta onboarding />
            <Button
              disabled={moving || !status.channels.meta}
              onClick={() => void go(nextSetupStep(installation ?? {}, step))}
            >
              Continue
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <AsyncForm
              submitLabel="Set up later"
              submitVariant="outline"
              fullWidth
              success={false}
              onSubmit={() => deferMeta({})}
            />
          </>
        )}
        {step === "aws" &&
          (installation?.accountId && !editingConnection ? (
            <>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>AWS account {installation.accountId}</ItemTitle>
                  <ItemDescription>Your saved AWS connection.</ItemDescription>
                </ItemContent>
                <Badge variant="success">Connected</Badge>
              </Item>
              <Button
                disabled={moving}
                onClick={() =>
                  void go(nextSetupStep(installation ?? {}, "aws"))
                }
              >
                Continue
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditingConnection(true)}
              >
                Change connection
              </Button>
            </>
          ) : (
            <>
              <AwsConnectionForm
                status={status}
                updating={!!installation?.accountId}
              />
              {!installation?.accountId && (
                <AsyncForm
                  submitLabel="Set up email later"
                  submitVariant="outline"
                  fullWidth
                  success={false}
                  onSubmit={() => deferEmail({})}
                />
              )}
            </>
          ))}
        {step === "callback" && <DeliveryUrlForm status={status} />}
        {step === "resources" && (
          <>
            <SesRegions status={status} />
            <SetupDetails label="What will be created?">
              <p className="text-sm text-muted-foreground">
                An SNS topic for delivery events and an SQS queue to recover
                missed updates. Each domain gets its own sending configuration.
              </p>
              <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
                {prefix}-events
                <br />
                {prefix}-events-dlq
              </p>
            </SetupDetails>
            {ready ? (
              <Button
                disabled={moving}
                onClick={() => void go(nextSetupStep(installation ?? {}, step))}
              >
                Continue
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            ) : (
              <AsyncForm
                fullWidth
                submitLabel={busy ? "Setting up…" : "Set up AWS resources"}
                disabled={busy}
                success={false}
                onSubmit={async () => {
                  for (const region of status.regions)
                    if (region.phase !== "ready")
                      await provision({ region: region.region })
                }}
              />
            )}
          </>
        )}
        {step === "team" &&
          (active?.ssoRequired ? (
            <TeamAccess onboarding />
          ) : active ? (
            <>
              <p className="text-sm">{active.name}</p>
              {!needsEmail ? (
                <AsyncForm
                  fullWidth
                  submitLabel="Finish setup"
                  success={false}
                  onSubmit={async () => {
                    await complete({ organizationId: active.id })
                    router.replace("/channels")
                  }}
                />
              ) : (
                <Button disabled={moving} onClick={() => void go("domain")}>
                  Continue
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              )}
            </>
          ) : (
            <CreateTeamForm />
          ))}
        {step === "domain" && (
          <>
            {active && !tenantReady && (
              <TeamSesStatus organizationId={active.id} />
            )}
            <Button
              disabled={!active || !tenantReady}
              onClick={() => setAddOpen(true)}
            >
              Add first domain
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <p className="text-xs text-muted-foreground">
              Next: finish DNS verification from your dashboard.
            </p>
            <AddDomainDialog open={addOpen} onOpenChange={setAddOpen} />
          </>
        )}
      </section>
      {index === steps.length - 1 && (
        <p className="text-sm text-muted-foreground">
          <Link href="/instance/ses">Email</Link>:{" "}
          {status.channels.email ? "set up" : "set up later"} ·{" "}
          <Link href="/instance/meta">Meta</Link>:{" "}
          {status.channels.meta ? "set up" : "set up later"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <nav
        aria-label="Setup navigation"
        className="flex items-center justify-between gap-2 border-t pt-4"
      >
        {index > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={moving || busy}
            onClick={() => void go(steps[index - 1])}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckIcon className="size-3 shrink-0" />
          Progress saved
        </span>
      </nav>
    </div>
  )
}
