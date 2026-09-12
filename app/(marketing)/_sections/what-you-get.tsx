import {
  Announcement,
  Browser,
  ChartColumn,
  Code,
  Dataflow,
  FileCode,
  Flask,
  Globe,
  KeyRound,
  Send,
  Server,
  ShieldTick,
  Users,
  type MarketingIcon,
} from "@/components/marketing/icons"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import {
  formatPlatforms,
  PlatformTags,
} from "@/components/marketing/platform-chips"
import { SectionHeader } from "@/components/marketing/section-header"
import { WHAT_YOU_GET } from "@/content/landing"
import type { Platform } from "@/content/landing"
import { cn } from "@/lib/utils"

const ICONS: Record<string, MarketingIcon> = {
  globe: Globe,
  "key-round": KeyRound,
  send: Send,
  server: Server,
  browser: Browser,
  code: Code,
  "file-code": FileCode,
  dataflow: Dataflow,
  users: Users,
  announcement: Announcement,
  "chart-column": ChartColumn,
  "shield-tick": ShieldTick,
  flask: Flask,
}

/* What's inside, as one continuous grid. Row one: the three pillars (send,
   deliver, see), each with line art on a dot field clipped at the cell's
   bottom rule. Row two: a full-width strip on the same dot field, holding
   the three things set up once, so the pillars read as standing on the
   layer they share. Then a 3x3 of features, each cell closing with tags
   for where it ships. */
export function WhatYouGet() {
  const features = WHAT_YOU_GET.features
  return (
    <section id="inside" className="section scroll-mt-16 pb-0">
      <div className="px-6 md:px-10">
        <SectionHeader
          title={
            <>
              {WHAT_YOU_GET.titleA} <em>{WHAT_YOU_GET.titleEm}</em>
            </>
          }
          description={WHAT_YOU_GET.sub}
        />
      </div>

      <Stagger className="grid-cells corners-t mt-14 grid border-double-t lg:grid-cols-3">
        {WHAT_YOU_GET.apps.map((app) => {
          const Icon = ICONS[app.icon]
          return (
            <StaggerItem key={app.id} className="flex flex-col pb-0">
              <span className="icon-tile">
                <Icon strokeWidth={1.5} />
              </span>
              <h3 className="mt-4 text-h4">{app.title}</h3>
              <p className="mt-0.5 font-mono text-caption font-normal text-faint-foreground">
                {app.stack}
              </p>
              <p className="mt-2 text-small text-muted-foreground">
                {app.body}
              </p>
              <AppArt kind={app.id} />
            </StaggerItem>
          )
        })}
        <StaggerItem className="lg:col-span-3">
          <SharedLayer />
        </StaggerItem>
      </Stagger>

      <Stagger className="grid-cells grid sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => {
          const Icon = ICONS[feature.icon]
          /* an odd count leaves one cell alone on the last two-up row; let
             it take the row so the grid stays closed */
          const alone = i === features.length - 1 && features.length % 2 === 1
          return (
            <StaggerItem
              key={feature.title}
              className={cn(
                "flex flex-col gap-4",
                alone && "sm:col-span-2 lg:col-span-1"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="icon-tile size-8 [&_svg]:size-4">
                  <Icon strokeWidth={1.5} />
                </span>
                <h3 className="text-small font-semibold">{feature.title}</h3>
              </div>
              <p className="text-small text-muted-foreground">
                {feature.body}
                <span className="sr-only">
                  {" "}
                  Ships on {formatPlatforms(feature.platforms)}.
                </span>
              </p>
              <PlatformTags platforms={feature.platforms} className="mt-auto" />
            </StaggerItem>
          )
        })}
      </Stagger>
    </section>
  )
}

/* The layer the three pillars stand on: the dot field from behind the art
   runs on across the whole row, with the three shared pieces in the
   middle. */
function SharedLayer() {
  return (
    <>
      <div aria-hidden="true" className="dotgrid absolute inset-0" />
      <div className="relative flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-5">
        <p className="text-caption text-muted-foreground">
          {WHAT_YOU_GET.shared.label}
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-2">
          {WHAT_YOU_GET.shared.items.map((item) => {
            const Icon = ICONS[item.icon]
            return (
              <li key={item.label} className="pill">
                <Icon strokeWidth={1.75} />
                {item.label}
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

/* Line art per pillar on a dot field that fades in from above and is clipped
   at the cell's bottom rule, so the art sits on the shared row below.
   1px borders and muted bars; one accent bar apiece to show the shared
   tokens. Decorative only. */
function AppArt({ kind }: { kind: Platform }) {
  return (
    <div className="mt-auto pt-6" aria-hidden="true">
      <div className="relative h-36 overflow-hidden">
        <div className="dotgrid absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_70%)]" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-center">
          {kind === "dashboard" && <BrowserArt />}
          {kind === "api" && <TerminalArt />}
          {kind === "smtp" && <TableArt />}
        </div>
      </div>
    </div>
  )
}

function BrowserArt() {
  return (
    <div className="flex h-28 w-64 max-w-[92%] flex-col rounded-t-xl border border-b-0 border-border bg-surface shadow-card">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="size-1.5 rounded-full bg-border-strong" />
        <span className="size-1.5 rounded-full bg-border-strong" />
        <span className="size-1.5 rounded-full bg-border-strong" />
        <span className="ml-2 h-3 flex-1 rounded-sm border border-border bg-background" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[30%] flex-col gap-2 border-r border-border p-3">
          <span className="h-1.5 w-3/5 rounded-full bg-border-strong" />
          <span className="h-1.5 w-4/5 rounded-full bg-primary/30" />
          <span className="h-1.5 w-2/3 rounded-full bg-muted" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <span className="h-2 w-2/5 rounded-full bg-border-strong" />
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-8 rounded-md border border-border" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TerminalArt() {
  return (
    <div className="flex h-28 w-64 max-w-[92%] flex-col rounded-t-xl border border-b-0 border-border bg-terminal font-mono text-[10px] shadow-card">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <span className="size-1.5 rounded-full bg-terminal-dot" />
        <span className="size-1.5 rounded-full bg-terminal-dot" />
        <span className="size-1.5 rounded-full bg-terminal-dot" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 leading-relaxed">
        <span className="text-terminal-foreground/60">
          $ curl -X POST /emails
        </span>
        <span className="text-terminal-foreground/60">
          {`{ "from": "you@yourdomain.com", … }`}
        </span>
        <span className="text-terminal-foreground">
          → 201 {`{ "id": "em_9f2…" }`}
        </span>
      </div>
    </div>
  )
}

function TableArt() {
  const rows = [
    { name: "domains", accent: false },
    { name: "api_keys", accent: true },
    { name: "emails", accent: false },
    { name: "suppression", accent: false },
  ]
  return (
    <div className="flex h-28 w-64 max-w-[92%] flex-col rounded-t-xl border border-b-0 border-border bg-surface font-mono text-[10px] shadow-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-faint-foreground">
        <span>schema.ts</span>
        <span className="size-1.5 rounded-full bg-success" />
      </div>
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex items-center justify-between border-b border-border px-3 py-1.5 last:border-0"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              className={
                row.accent
                  ? "size-1.5 rounded-full bg-primary"
                  : "size-1.5 rounded-full bg-border-strong"
              }
            />
            {row.name}
          </span>
          <span className="h-1.5 w-10 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  )
}
