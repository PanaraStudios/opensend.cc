"use client"
import * as React from "react"
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
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
import { AddDomainDialog } from "@/components/dashboard/domains/list"
import { TeamSesStatus } from "./team-ses-status"
import {
  AwsConnectionForm,
  SetupDetails,
} from "@/components/ses/connection-form"
import { DeliveryUrlForm } from "@/components/ses/delivery-form"
import { SesRegions } from "@/components/ses/regions"
import { actionError } from "@/lib/action-error"
const steps = [
  "welcome",
  "aws",
  "callback",
  "resources",
  "team",
  "domain",
] as const
type Step = (typeof steps)[number]
const copy: Record<
  Step,
  { label: string; title: string; description: string }
> = {
  welcome: {
    label: "Welcome",
    title: "Set up Opensend",
    description: "Bring your AWS account and a domain you own.",
  },
  aws: {
    label: "AWS account",
    title: "Connect your AWS account",
    description: "Choose a region and add your AWS access keys.",
  },
  callback: {
    label: "Delivery updates",
    title: "Receive delivery updates",
    description: "Give AWS an address for delivery and bounce events.",
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
  const inferred: Step = installation?.accountId
    ? installation.environmentCheckedAt
      ? ready
        ? active
          ? "domain"
          : "team"
        : "resources"
      : "callback"
    : "welcome"
  const step = installation?.setupStep ?? inferred
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
  const firstDomain = domains?.page[0]
  React.useEffect(() => {
    if (!installation?.completedAt && firstDomain && active && tenantReady)
      void complete({ organizationId: active.id })
        .then(() => router.replace(`/domains/${firstDomain._id}`))
        .catch((e) => setError(actionError(e)))
  }, [
    installation?.completedAt,
    firstDomain,
    active,
    tenantReady,
    complete,
    router,
  ])
  React.useEffect(() => {
    heading.current?.focus()
  }, [step])
  if (!status) return <Skeleton className="h-40 w-full" />
  if (!status.admin)
    return (
      <Alert>
        <AlertTitle>Setup is in progress</AlertTitle>
        <AlertDescription>
          Your installation administrator is setting up Opensend.
        </AlertDescription>
      </Alert>
    )
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
      <section
        key={step}
        aria-label={copy[step].title}
        className="flex flex-col gap-5"
      >
        {step === "welcome" && (
          <>
            <ItemGroup className="gap-2">
              {[
                {
                  Icon: CloudIcon,
                  title: "Connect AWS",
                  description: "Use your own Amazon SES account.",
                },
                {
                  Icon: UsersIcon,
                  title: "Create a team",
                  description: "Keep your projects and sending separate.",
                },
                {
                  Icon: GlobeIcon,
                  title: "Add a domain",
                  description: "Finish DNS setup from your dashboard.",
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
              <Button disabled={moving} onClick={() => void go("callback")}>
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
            <AwsConnectionForm
              status={status}
              updating={!!installation?.accountId}
            />
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
                opensend-{installation?._id}-events
                <br />
                opensend-{installation?._id}-events-dlq
              </p>
            </SetupDetails>
            {ready ? (
              <Button disabled={moving} onClick={() => void go("team")}>
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
              <Button disabled={moving} onClick={() => void go("domain")}>
                Continue
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </>
          ) : (
            <CreateTeamForm onCreated={() => navigate({ step: "domain" })} />
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
